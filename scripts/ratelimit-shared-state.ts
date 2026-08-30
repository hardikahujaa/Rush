/**
 * Proves the rate-limit counter lives in Redis, not in a process.
 *
 *   npm run ratelimit-shared     (dev server must be running)
 *
 * ── WHY THIS AND NOT A LATENCY MEASUREMENT ────────────────────────────────
 * "It took 92ms, so it must be Redis" is weak: latency can come from anywhere.
 * This instead spends the whole allowance from THIS script's process, then asks
 * the DEV SERVER - a different OS process, with its own memory - for one more.
 *
 * A `Map` is not shared between processes. If the dev server refuses that
 * request, it can only be because it read a counter this script wrote somewhere
 * outside both of them. That is not an inference about speed; it is the only
 * available explanation.
 *
 * Run it against the in-memory fallback and it fails, which is what makes it
 * worth running.
 */
import { HOLD_RATE_LIMIT, isRedisConfigured } from "../src/lib/redis";
import { limitHolds } from "../src/lib/rate-limit";

const BASE = process.env.RUSH_BASE_URL ?? "http://localhost:3000";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  /* An address nothing else will use, so the run starts from a clean window. */
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const identifier = `ip:${ip}`;

  console.log(`\n  backend    : ${isRedisConfigured ? "redis (upstash)" : "in-memory (dev)"}`);
  console.log(`  identifier : ${identifier}`);
  console.log(`  pid        : ${process.pid}  (the dev server is a different one)\n`);

  console.log(`1. Spending all ${HOLD_RATE_LIMIT} requests from THIS process`);
  const verdicts = [];
  for (let i = 0; i < HOLD_RATE_LIMIT; i++) verdicts.push(await limitHolds(identifier));
  console.log(`   allowed: ${verdicts.map((v) => v.success).join(" ")}`);
  console.log(`   backend: ${verdicts[0].backend}`);

  check(`all ${HOLD_RATE_LIMIT} were allowed here`, verdicts.every((v) => v.success));
  check("this process used the redis backend", verdicts[0].backend === "redis",
    verdicts[0].backend);

  console.log("\n2. Asking the DEV SERVER for one more, as the same identifier");
  const response = await fetch(`${BASE}/api/holds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ seatIds: ["00000000-0000-4000-8000-000000000000"] }),
  });
  console.log(`   status: ${response.status}`);

  /* THE ASSERTION. 401 would mean the server's counter started at zero - a
     private, per-process count. 429 means it saw the five this process spent. */
  check(
    "the dev server refuses it — the counter crossed a process boundary",
    response.status === 429,
    response.status === 401
      ? "got 401: the server counted from zero, so the state is NOT shared"
      : `got ${response.status}`,
  );
}

main()
  .catch((error) => {
    failed++;
    console.error("\n  UNCAUGHT:", (error as Error)?.message ?? error);
    console.error(`  Is the dev server running on ${BASE}?`);
  })
  .finally(() => {
    console.log("─".repeat(64));
    console.log(
      failed === 0
        ? "PASS — one counter, two processes. The state is in Upstash."
        : `${failed} FAILED`,
    );
    process.exit(failed === 0 ? 0 : 1);
  });
