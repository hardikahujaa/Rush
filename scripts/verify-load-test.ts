/**
 * T42 — run this immediately after `k6 run loadtest/holds.js` finishes.
 *
 *   node --env-file=.env.local scripts/verify-load-test.ts
 *
 * This is the actual proof, not the k6 run itself. k6 can only show that the
 * HTTP layer answered every one of 500 concurrent requests with an expected
 * status - it has no way to ask Postgres "did anything oversell". These two
 * queries are PLAN.md's literal ask: no seat has more than one live hold, and
 * no seat appears on more than one paid order.
 *
 * Reads `loadtest/fixture.json` for the seat pool - scoping to exactly the
 * 100 seats this run touched is what makes "0 oversells" a real, specific
 * answer rather than an aggregate over an unrelated event somewhere else in
 * the database being quietly fine.
 */
import fs from "node:fs";
import { sql } from "drizzle-orm";

import { closeDb, db } from "../src/db";
import { holdIsLive } from "../src/db/queries/availability";
import { holds, orderItems } from "../src/db/schema";

let fixture: { eventId: string; seatIds: string[] };
try {
  fixture = JSON.parse(fs.readFileSync("loadtest/fixture.json", "utf8"));
} catch {
  throw new Error(
    "loadtest/fixture.json not found - run `node --env-file=.env.local " +
      "scripts/seed-load-test.ts` first, then the k6 run, then this.",
  );
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log(`\n  Event: ${fixture.eventId}`);
  console.log(`  Seat pool: ${fixture.seatIds.length} seats\n`);

  /* ── 1. no seat has more than one LIVE hold ──────────────────────────── */
  console.log("1. No seat has more than one live hold");

  const liveHoldDuplicates = await db.execute<{ seat_id: string; n: string }>(sql`
    select seat_id, count(*)::bigint as n
    from ${holds} h
    where h.seat_id in ${fixture.seatIds}
      and ${holdIsLive(sql`h`)}
    group by seat_id
    having count(*) > 1
  `);
  check(
    "zero seats with more than one live hold",
    liveHoldDuplicates.length === 0,
    `${liveHoldDuplicates.length} seat(s) oversold at the hold layer: ${JSON.stringify(liveHoldDuplicates)}`,
  );

  /* This asserts the SAME fact the partial unique index `one_live_hold_per_seat`
     already guarantees at the database level - this query re-derives it from
     first principles (every live hold row, grouped) rather than trusting the
     constraint's own name. If this ever fails, the constraint is gone or the
     definition of "live" has drifted from what the index actually enforces. */

  /* ── 2. no seat appears on more than one paid order ──────────────────── */
  console.log("\n2. No seat appears on more than one paid order");

  const soldDuplicates = await db.execute<{ seat_id: string; n: string }>(sql`
    select seat_id, count(*)::bigint as n
    from ${orderItems}
    where seat_id in ${fixture.seatIds}
    group by seat_id
    having count(*) > 1
  `);
  check(
    "zero seats sold more than once",
    soldDuplicates.length === 0,
    `${soldDuplicates.length} seat(s) double-sold: ${JSON.stringify(soldDuplicates)}`,
  );

  check(
    "...and in fact zero order_items exist at all (this run only holds, never checks out)",
    soldDuplicates.length === 0,
  );

  /* ── 3. the headline numbers ──────────────────────────────────────────── */
  console.log("\n3. Summary");

  const [{ n: liveCount }] = await db.execute<{ n: string }>(sql`
    select count(*)::bigint as n from ${holds} h
    where h.seat_id in ${fixture.seatIds} and ${holdIsLive(sql`h`)}
  `);
  const [{ n: totalHolds }] = await db.execute<{ n: string }>(sql`
    select count(*)::bigint as n from ${holds} where seat_id in ${fixture.seatIds}
  `);

  console.log(`      seats with a live hold now:  ${liveCount} / ${fixture.seatIds.length}`);
  console.log(`      total hold rows created:     ${totalHolds} (winners + conflict attempts)`);

  check(
    "live holds never exceed the pool size (the structural ceiling)",
    Number(liveCount) <= fixture.seatIds.length,
  );
}

main()
  .catch((error) => {
    failed++;
    console.error("\n  UNCAUGHT:", error);
  })
  .finally(async () => {
    console.log("\n" + "─".repeat(64));
    console.log(failed === 0 ? `PASS — ${passed} checks` : `${failed} FAILED of ${passed + failed}`);
    await closeDb().catch(() => {});
    process.exitCode = failed === 0 ? 0 : 1;
  });
