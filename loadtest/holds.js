/**
 * T42 — the load test.
 *
 *   k6 run loadtest/holds.js
 *   BASE_URL=https://your-app.vercel.app k6 run loadtest/holds.js
 *
 * Needs `loadtest/fixture.json`, written by `scripts/seed-load-test.ts` -
 * run that first.
 *
 * ── WHY `per-vu-iterations`, NOT `shared-iterations` ───────────────────────
 * The obvious executor for "500 users, 500 attempts" looks like
 * `shared-iterations` (500 iterations shared across up to 500 VUs) - and it
 * was rejected after reading exactly what it guarantees: it distributes WORK
 * across workers, not identities. A VU that finishes fast can pick up a
 * SECOND iteration from the shared pool before a slower VU has run even
 * once - which would mean this VU's cookie (`fixture.cookies[__VU - 1]`)
 * fires the request twice while some other prepared identity never fires at
 * all. That breaks the thing this test is actually checking: 500 DISTINCT
 * real buyers, each clicking buy exactly once. `per-vu-iterations` with
 * `iterations: 1` guarantees precisely one run per VU - `__VU` maps to
 * `fixture.cookies[__VU - 1]` with no ambiguity, ever.
 *
 * ── WHY "OVER 30 SECONDS" IS A JITTERED SLEEP, NOT A RAMP ──────────────────
 * `ramping-vus` would give a literal arrival ramp, but it reuses VUs across
 * iterations within a stage - the same "which identity actually fired"
 * ambiguity `shared-iterations` has, just shaped differently. Instead, every
 * VU sleeps a random 0-25s before its one request - 500 independent coin
 * flips land roughly uniformly across the window, which is what "500 people
 * clicking buy over the 30 seconds after a drop" actually looks like (nobody
 * clicks in the exact same millisecond), while keeping the 1:1 VU/identity
 * guarantee completely intact.
 *
 * ── WHAT SUCCESS LOOKS LIKE ─────────────────────────────────────────────── *
 * This test does NOT expect every request to return 200. With 500 people and
 * 100 seats, at least 400 MUST lose the race - that is the point. A run
 * where everyone gets 200 would mean the seat pool was bigger than intended,
 * not that the system passed. What this run is actually checking:
 *
 *   1. Every response is 200, 409 (SEATS_UNAVAILABLE) or 429 (rate limited) -
 *      never a 500, never a hung connection. A correctness bug under load
 *      usually shows up as an unexpected status or a timeout, not as "too
 *      many successes" - the database constraints make overselling
 *      structurally impossible regardless of what this script does.
 *   2. The real proof - "no seat has more than one live hold" - is a SQL
 *      query run AFTER this finishes, in `scripts/verify-load-test.ts`. k6
 *      cannot assert that from here; it can only prove the HTTP layer never
 *      panicked while 500 people found that out concurrently.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const fixture = JSON.parse(open("./fixture.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

/* Custom counters - the exact "success/conflict split" PLAN.md's CV-bullet
   template asks for, printed in k6's own end-of-run summary without needing
   to post-process the raw HTTP metrics by hand. */
const holdSuccess = new Counter("rush_hold_success");
const holdConflict = new Counter("rush_hold_conflict");
const holdRateLimited = new Counter("rush_hold_rate_limited");
const holdUnexpected = new Counter("rush_hold_unexpected");

/**
 * k6's `http_req_failed` metric is 1 for ANY response with status >= 400 by
 * default - it has no way to know a 409 here means "the lock worked exactly
 * as designed," not "something broke." `expectedStatuses` tells it which
 * non-2xx codes are legitimate business outcomes rather than failures, which
 * is what makes the threshold below actually mean something: with 500
 * people and 100 seats, at least 400 x `409`s are GUARANTEED, and a 500-vs-
 * 409 misclassification would make `http_req_failed` cross any sane
 * threshold on every single run regardless of whether anything was wrong.
 */
http.setResponseCallback(http.expectedStatuses(200, 409, 429));

export const options = {
  scenarios: {
    drop: {
      executor: "per-vu-iterations",
      vus: fixture.cookies.length,
      iterations: 1,
      maxDuration: "60s", // safety ceiling; the jitter below keeps real traffic inside ~30s
    },
  },
  /* With `expectedStatuses` above, `http_req_failed` now means what it
     looks like it means: a genuine 5xx, a dropped connection, or a timeout -
     never a 409 from someone correctly losing the race. */
  thresholds: {
    http_req_failed: ["rate<0.01"],
    rush_hold_unexpected: ["count==0"],
  },
};

export default function dropAttempt() {
  sleep(Math.random() * 25);

  const cookie = fixture.cookies[__VU - 1];
  const seatId = fixture.seatIds[Math.floor(Math.random() * fixture.seatIds.length)];

  const res = http.post(
    `${BASE_URL}/api/holds`,
    JSON.stringify({ seatIds: [seatId] }),
    { headers: { "Content-Type": "application/json", Cookie: cookie } },
  );

  check(res, {
    "status is 200, 409, or 429": (r) => [200, 409, 429].includes(r.status),
  });

  if (res.status === 200) holdSuccess.add(1);
  else if (res.status === 409) holdConflict.add(1);
  else if (res.status === 429) holdRateLimited.add(1);
  else {
    holdUnexpected.add(1);
    console.error(`unexpected status ${res.status}: ${res.body}`);
  }
}

/** Printed once, at the very end, in addition to k6's own summary - the four
 *  numbers PLAN.md's CV bullet wants, in one place. */
export function handleSummary(data) {
  const m = data.metrics;
  const total = (m.http_reqs && m.http_reqs.values.count) || 0;
  const success = (m.rush_hold_success && m.rush_hold_success.values.count) || 0;
  const conflict = (m.rush_hold_conflict && m.rush_hold_conflict.values.count) || 0;
  const limited = (m.rush_hold_rate_limited && m.rush_hold_rate_limited.values.count) || 0;
  const unexpected = (m.rush_hold_unexpected && m.rush_hold_unexpected.values.count) || 0;
  const p95 = (m.http_req_duration && m.http_req_duration.values["p(95)"]) || 0;

  const summary = {
    requests: total,
    successes: success,
    conflicts: conflict,
    rateLimited: limited,
    unexpected,
    p95Ms: Math.round(p95 * 100) / 100,
    seatPool: fixture.seatIds.length,
    virtualUsers: fixture.cookies.length,
  };

  console.log("\n" + "=".repeat(64));
  console.log("  T42 CV-BULLET NUMBERS");
  console.log("=".repeat(64));
  console.log(`  Requests:              ${summary.requests}`);
  console.log(`  Oversells:             see scripts/verify-load-test.ts (must be 0)`);
  console.log(`  p95 latency:           ${summary.p95Ms} ms`);
  console.log(
    `  Success/conflict split: ${summary.successes} success / ${summary.conflicts} conflict` +
      ` / ${summary.rateLimited} rate-limited / ${summary.unexpected} unexpected`,
  );
  console.log("=".repeat(64) + "\n");

  /* No `stdout` key here, deliberately - k6's own default end-of-run summary
     (duration, checks, VU count, data transferred) still prints normally;
     this only ADDS the four CV-bullet numbers above it and saves them to a
     file, rather than replacing information k6 already gives for free. */
  return {
    "loadtest/summary.json": JSON.stringify(summary, null, 2),
  };
}
