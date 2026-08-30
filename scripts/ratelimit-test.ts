/**
 * T23 — proves the rate limit actually rejects.
 *
 *   npm run ratelimit-test          (dev server must be running)
 *
 * Fires requests over real HTTP at the real route, so this exercises the whole
 * path: identifier resolution, the limiter, the 429, and its headers.
 *
 * ── WHY UNAUTHENTICATED REQUESTS ARE THE RIGHT PROBE ──────────────────────
 * The limiter runs BEFORE authentication. So an unauthenticated caller that is
 * still under the limit gets 401 (it passed the limiter, then failed auth), and
 * one over the limit gets 429. That boundary - 401s turning into 429s at exactly
 * the sixth request - is the clearest possible evidence the limiter sits above
 * the database work, and it needs no login to demonstrate.
 */
import { HOLD_RATE_LIMIT, isRedisConfigured } from "../src/lib/redis";

const BASE = process.env.RUSH_BASE_URL ?? "http://localhost:3000";
const ATTEMPTS = HOLD_RATE_LIMIT + 3;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** One request. `xff` lets us pretend to be a different caller. */
async function attempt(xff: string) {
  const response = await fetch(`${BASE}/api/holds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": xff },
    body: JSON.stringify({ seatIds: ["00000000-0000-4000-8000-000000000000"] }),
  });
  return {
    status: response.status,
    retryAfter: response.headers.get("Retry-After"),
    limit: response.headers.get("RateLimit-Limit"),
    remaining: response.headers.get("RateLimit-Remaining"),
    body: await response.json().catch(() => null),
  };
}

async function main() {
  console.log(`\n  backend: ${isRedisConfigured ? "redis (upstash)" : "in-memory (dev)"}`);
  console.log(`  limit  : ${HOLD_RATE_LIMIT} requests per 10 s per identifier\n`);

  /* A unique address per run, so a re-run is not throttled by the previous. */
  const caller = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  const other = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

  console.log(`1. ${ATTEMPTS} requests from one identifier`);
  const results = [];
  for (let i = 0; i < ATTEMPTS; i++) results.push(await attempt(caller));
  console.log(`   statuses: ${results.map((r) => r.status).join(" ")}`);

  const allowed = results.filter((r) => r.status !== 429);
  const blocked = results.filter((r) => r.status === 429);

  check(`exactly ${HOLD_RATE_LIMIT} got through`, allowed.length === HOLD_RATE_LIMIT,
    `${allowed.length} passed`);
  check(`the remaining ${ATTEMPTS - HOLD_RATE_LIMIT} were rejected with 429`,
    blocked.length === ATTEMPTS - HOLD_RATE_LIMIT, `${blocked.length} blocked`);
  /* 401, not 500: the ones that got through reached the auth check, which means
     the limiter let them past rather than erroring. */
  check("the allowed ones reached auth (401, not 500)",
    allowed.every((r) => r.status === 401),
    allowed.map((r) => r.status).join(","));

  console.log("\n2. The 429 response");
  const first429 = blocked[0];
  check("carries Retry-After", Boolean(first429?.retryAfter), "header missing");
  const seconds = Number(first429?.retryAfter);
  check("Retry-After is a sane number of seconds", seconds >= 1 && seconds <= 10,
    `got ${first429?.retryAfter}`);
  check("reports the limit in RateLimit-Limit",
    first429?.limit === String(HOLD_RATE_LIMIT), `got ${first429?.limit}`);
  check("keeps the standard error envelope",
    first429?.body?.error?.code === "RATE_LIMITED",
    JSON.stringify(first429?.body)?.slice(0, 80));
  check("says something a person can act on",
    typeof first429?.body?.error?.message === "string" &&
      first429.body.error.message.length > 10,
    first429?.body?.error?.message);

  /* The whole point of a per-identifier limit: one caller being throttled must
     not throttle everyone else. A global counter would fail here, and would be
     an outage during a drop rather than a defence. */
  console.log("\n3. A different identifier is unaffected");
  const stranger = await attempt(other);
  check("second caller is not blocked by the first's burst",
    stranger.status !== 429, `got ${stranger.status}`);

  console.log("\n4. The window frees up");
  console.log("   waiting 10s for the sliding window to clear…");
  await new Promise((r) => setTimeout(r, 10_500));
  const afterWait = await attempt(caller);
  check("the original caller is allowed again", afterWait.status !== 429,
    `got ${afterWait.status}`);
}

main()
  .catch((error) => {
    failed++;
    console.error("\n  UNCAUGHT:", (error as Error)?.message ?? error);
    console.error("  Is the dev server running on " + BASE + "?");
  })
  .finally(() => {
    console.log("─".repeat(60));
    console.log(failed === 0 ? "PASS — the limiter rejects, and only the right caller." : `${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  });
