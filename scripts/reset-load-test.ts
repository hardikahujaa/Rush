/**
 * T42 — release every hold the load test created, so the fixture event's
 * 100 seats are free again for another run.
 *
 *   node --env-file=.env.local scripts/reset-load-test.ts
 *
 * Deliberately NOT a full re-seed: the 500 Supabase Auth accounts and the
 * fixture event/seats are reusable fixtures, not part of what one run
 * leaves behind. Recreating 500 real accounts through Supabase's Auth API
 * on every iteration while tuning `DB_POOL_MAX` or the VU count would be
 * the slow part of the loop; this only clears the ONE thing that actually
 * changes between runs - who currently holds what.
 */
import { and, inArray, isNull, sql } from "drizzle-orm";
import fs from "node:fs";

import { closeDb, db } from "../src/db";
import { holds } from "../src/db/schema";

async function main() {
  const fixture = JSON.parse(fs.readFileSync("loadtest/fixture.json", "utf8")) as {
    seatIds: string[];
  };

  /* Only live rows - matches `releaseExpiredHolds`'s own WHERE shape, so a
     hold this script already released on a previous run is left alone
     rather than having its timestamp needlessly rewritten.

     `seats.status` is deliberately NOT touched here. It is a render cache
     that nothing in the hold/availability path is allowed to depend on
     (T22) - and this fixture event is never rendered through the real seat
     map UI during this test, only hit through /api/holds directly, so there
     is no reader for a stale cache to mislead. The next real query already
     recomputes availability from `holds`/`order_items` live. */
  const released = await db
    .update(holds)
    .set({ releasedAt: sql`now()` })
    .where(and(inArray(holds.seatId, fixture.seatIds), isNull(holds.releasedAt)))
    .returning({ seatId: holds.seatId });

  console.log(
    `\n  Released ${released.length} hold(s) across ${fixture.seatIds.length} seats. ` +
      "Ready for another run.\n",
  );
}

main()
  .catch((error) => {
    console.error("\n  FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
