import "server-only";

import { eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { repairSeatStatus } from "@/db/queries/holds";
import { holds, orderItems, orders } from "@/db/schema";

/**
 * T47 — undo a demo rehearsal, leave the seed catalogue alone.
 *
 * ── WHY "RESET" DOES NOT MEAN `db:seed` ─────────────────────────────────────
 * `db:seed` deletes every venue, event and section and rebuilds them from
 * scratch - which would also erase the extra catalogue `seed-events.ts` added
 * for T17 and every real account anyone signed up with. That is not what a
 * presenter means by "reset the demo" mid-rehearsal; it is what you run once,
 * before the demo exists at all. This resets ACTIVITY, not the catalogue.
 *
 * ── THE SEED/REAL BOUNDARY IS ONE STRING, AND IT ALREADY EXISTED ──────────
 * `seed.ts` stamps every baseline order it creates with
 * `stripeSessionId: cs_test_seed_${randomUUID()}` specifically so this
 * function would have something reliable to filter on. A real checkout
 * - whether from a rehearsal or an actual buyer - gets its session id from
 * Stripe itself, which never produces that prefix. So "every order that is
 * NOT seed data" is exactly "every order a live checkout created," with no
 * extra flag column needed. `IS NULL` is included for a pending order whose
 * Stripe call never completed (see `deleteOrphanedPendingOrder`) - a bare
 * `NOT LIKE` against a null session id evaluates to null, not true, and would
 * silently skip exactly the half-finished rows this exists to clean up.
 *
 * ── WHY `holds` NEEDS NO SUCH FILTER ─────────────────────────────────────
 * `seed.ts` never inserts into `holds` at all - the presold seats it creates
 * go straight to `orders`/`order_items`, bypassing the hold mechanism
 * entirely (see its own comment on why: faking status without a real order
 * would lie to T22 and T36). So every row ever written to `holds` came from a
 * real `/api/holds` call, and releasing all of them is always safe.
 *
 * ── DELETE, NOT RELEASE, FOR ORDERS ────────────────────────────────────────
 * `releaseHolds` sets `released_at` and keeps the row, because a hold's history
 * feeds the funnel analytics in T36. An order is different: "re-run my demo
 * without the seats already being sold" means the dashboard should show
 * exactly as many sales as the rehearsal is about to make, not the rehearsal's
 * plus a new one. `orderItems`/`tickets` both have `onDelete: "cascade"` on
 * their `orderId`, so deleting the `orders` row is enough to take both with
 * it - no separate deletes needed, and no window where a ticket outlives the
 * order that paid for it.
 */
const SEED_SESSION_PREFIX = "cs_test_seed_";

/**
 * "Real" as one raw condition, not a negated "is seed" - `not(or(...))`
 * typechecks against drizzle-orm's `SQLWrapper` only with an assertion, since
 * both combinators type their return as possibly `undefined` for the
 * zero-argument case neither of these calls makes. Writing the positive
 * condition directly avoids the mismatch instead of asserting past it.
 */
const isRealOrder = sql`(
  ${orders.stripeSessionId} is null
  or ${orders.stripeSessionId} not like ${`${SEED_SESSION_PREFIX}%`}
)`;

export async function resetDemoActivity(): Promise<{
  ordersCleared: number;
  holdsReleased: number;
  seatsRepaired: number;
}> {
  return db.transaction(async (tx) => {
    /* Read the seats behind every real order BEFORE the delete below cascades
       `order_items` out from under this query. */
    const soldSeats = await tx
      .select({ seatId: orderItems.seatId })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(isRealOrder);

    const deletedOrders = await tx
      .delete(orders)
      .where(isRealOrder)
      .returning({ id: orders.id });

    const releasedHolds = await tx
      .update(holds)
      .set({ releasedAt: sql`now()` })
      .where(isNull(holds.releasedAt))
      .returning({ seatId: holds.seatId });

    const seatIds = [
      ...new Set([
        ...soldSeats.map((r) => r.seatId),
        ...releasedHolds.map((r) => r.seatId),
      ]),
    ];
    const seatsRepaired = await repairSeatStatus(tx, seatIds);

    return {
      ordersCleared: deletedOrders.length,
      holdsReleased: releasedHolds.length,
      seatsRepaired,
    };
  });
}
