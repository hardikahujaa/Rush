import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/pg-error";
import { liveHoldOwner, seatHasLiveHold, seatIsSold } from "@/db/queries/availability";
import {
  holds,
  orderItems,
  orders,
  seats,
  sections,
  tickets,
  webhookEvents,
} from "@/db/schema";
import { signTicket } from "@/lib/qr";

/**
 * THE IDEMPOTENT WEBHOOK (T28).
 *
 * ── WHY STRIPE RETRIES AT ALL ───────────────────────────────────────────────
 * Stripe cannot tell the difference between "the handler never ran" and "the
 * handler ran perfectly and the reply was lost on the way back". Both look
 * identical from the outside: no 2xx arrived. So it assumes the worst and sends
 * the same event again, with exponential backoff, for up to three days. That is
 * the correct design - the alternative is silently losing a payment - but it
 * means EVERY handler is guaranteed to be invoked more than once eventually.
 *
 * ── WHAT IDEMPOTENT MEANS HERE ──────────────────────────────────────────────
 * Processing the same event N times must leave the database exactly as it would
 * be after processing it once. Not "roughly the same" - identical. Without that,
 * a single lost reply on a successful delivery issues a second set of tickets
 * for one payment: two QR codes for one seat, both cryptographically valid,
 * both admitting someone at the gate.
 *
 * ── WHY A `SELECT ... WHERE stripe_event_id = ?` PRE-CHECK IS NOT ENOUGH ────
 * The obvious implementation - "look it up, and if it is absent, process it" -
 * is itself a race, and the exact same class of race the hold transaction
 * exists to prevent. Stripe's retries can overlap: two deliveries of one event
 * arrive concurrently, both SELECT, both see nothing, both proceed, both insert
 * tickets. The read tells you about a moment that has already passed by the
 * time you act on it.
 *
 * So the guarantee does not come from the read. It comes from
 * `webhook_events_stripe_event_id_unique` and from inserting that row FIRST,
 * before any other work:
 *
 *   - the INSERT takes a lock on that index entry, so a concurrent duplicate
 *     BLOCKS there rather than racing past it
 *   - when the first transaction commits, the second's insert fails 23505 and
 *     its whole transaction rolls back, having changed nothing
 *
 * One row in a unique index is doing what no amount of application logic can:
 * making "has this event been handled?" a question the database answers
 * atomically. Same shape as `one_live_hold_per_seat` in T20 - the rule lives
 * where a TypeScript bug cannot reach it.
 *
 * ── THE THROW / RETURN CONTRACT, WHICH DECIDES WHETHER STRIPE RETRIES ───────
 * This is the subtlety that makes the difference between an endpoint that heals
 * and one that hammers itself forever:
 *
 *   RETURN a result  -> the transaction COMMITS, so the webhook_events row
 *                       survives, the event is marked seen, and the route
 *                       answers 2xx. Use this for any outcome that is DECIDED:
 *                       fulfilled, already paid, order missing, amounts
 *                       disagree. Retrying cannot change the answer, so Stripe
 *                       must be told to stop.
 *
 *   THROW            -> the transaction ROLLS BACK, the webhook_events row goes
 *                       with it, the route answers 5xx, and Stripe retries into
 *                       a clean slate. Use this only for TRANSIENT failures -
 *                       a dropped connection, a deadlock, an unknown bug.
 *
 * Getting this backwards in either direction is a real outage: return on a
 * transient error and a genuine payment is silently dropped; throw on a decided
 * failure and Stripe retries the same doomed event for three days.
 */

/** How many minutes of clock skew the signature check tolerates (Stripe's own
 *  default, restated here so the test can reason about it). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/* ── outcomes ───────────────────────────────────────────────────────────── */

export type FulfillOutcome =
  /** Tickets issued, seats sold, order paid. The normal path. */
  | {
      outcome: "fulfilled";
      orderId: string;
      ticketCount: number;
      totalCents: number;
      holdsReleased: number;
    }
  /** This exact event id was already recorded - a retry of something done. */
  | { outcome: "replayed" }
  /** The order was already paid, by a DIFFERENT event id. Nothing to do. */
  | { outcome: "already_paid"; orderId: string }
  /** metadata.orderId names an order that does not exist. */
  | { outcome: "order_not_found"; orderId: string }
  /** metadata.seatIds names seats that do not exist. */
  | { outcome: "seats_not_found"; seatIds: string[] }
  /**
   * PAID BUT UNDELIVERABLE - a human has to refund this. Should be unreachable
   * (see the note at the conflict check) and is logged as an incident.
   */
  | { outcome: "seat_conflict"; orderId: string; seatIds: string[] }
  /** Our records and Stripe's disagree. Refuses to fulfil; needs a human. */
  | { outcome: "mismatch"; orderId: string; reason: string };

export type ExpireOutcome =
  | { outcome: "expired"; orderId: string; holdsReleased: number; seatsRepaired: number }
  | { outcome: "replayed" }
  /** Never release the seats of an order that actually got paid. */
  | { outcome: "already_paid"; orderId: string }
  | { outcome: "order_not_found"; orderId: string };

/* ── postgres error mapping ─────────────────────────────────────────────── */

/**
 * True for the idempotency gate firing: this event id is already recorded.
 *
 * The constraint name is matched exactly (verified against the live database,
 * not guessed) so that a unique violation from some OTHER index - `one_sold_seat`,
 * `tickets_seat_unique` - is never silently reported as a harmless replay. Those
 * mean something has gone badly wrong and must surface, not be swallowed.
 *
 * Goes through `isUniqueViolation` because the Postgres code is NOT on the error
 * Drizzle throws - it is on `.cause`. Reading it off the top level typechecks,
 * returns `undefined`, and makes this function silently always-false, which on
 * this route means every duplicate delivery answers 500 and Stripe retries a
 * payment that was already fulfilled, for three days. See src/db/pg-error.ts.
 */
export function isWebhookReplay(error: unknown): boolean {
  return isUniqueViolation(error, "webhook_events_stripe_event_id_unique");
}

/* ── fulfilment ─────────────────────────────────────────────────────────── */

export async function fulfillCheckoutSession({
  stripeEventId,
  stripeSessionId,
  orderId,
  seatIds,
  amountTotal,
}: {
  stripeEventId: string;
  stripeSessionId: string;
  orderId: string;
  /** From metadata, already Zod-validated and de-duplicated. */
  seatIds: string[];
  /** What Stripe says the customer actually paid, in paise. */
  amountTotal: number;
}): Promise<FulfillOutcome> {
  const orderedSeatIds = [...new Set(seatIds)].sort();

  try {
    return await db.transaction(async (tx) => {
      /* ── 1. THE IDEMPOTENCY GATE, FIRST ───────────────────────────────
       * Before any read, any lock, any write. If this event has been seen,
       * the insert fails here and nothing below it ever runs. */
      await tx.insert(webhookEvents).values({ stripeEventId });

      /* ── 2. LOCK THE SEATS, ASCENDING ID ──────────────────────────────
       * Same lock, same order as `createHold` and `createPendingOrder`.
       * This handler competes with both: a buyer may be mid-hold on a seat
       * this webhook is about to sell. Every transaction in the codebase
       * acquiring seat locks in ascending id order is what makes a deadlock
       * cycle impossible - break the ordering in ONE place and the guarantee
       * is gone everywhere. */
      const locked = await tx
        .select({ id: seats.id, eventId: seats.eventId })
        .from(seats)
        .where(inArray(seats.id, orderedSeatIds))
        .orderBy(seats.id)
        .for("update");

      if (locked.length !== orderedSeatIds.length) {
        const found = new Set(locked.map((s) => s.id));
        return {
          outcome: "seats_not_found" as const,
          seatIds: orderedSeatIds.filter((id) => !found.has(id)),
        };
      }

      /* ── 3. THE ORDER ─────────────────────────────────────────────────── */
      const [order] = await tx
        .select({
          id: orders.id,
          userId: orders.userId,
          eventId: orders.eventId,
          totalCents: orders.totalCents,
          status: orders.status,
          stripeSessionId: orders.stripeSessionId,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) return { outcome: "order_not_found" as const, orderId };

      /**
       * Already paid, under a different event id.
       *
       * Reachable without any bug: Stripe sends `checkout.session.completed`
       * and, for some payment methods, `charge.succeeded` style follow-ups; a
       * dashboard "resend" also mints a NEW event id for the same session. The
       * webhook_events gate above only catches the SAME id, so this is the
       * second line of defence and the one that stops a resend from issuing a
       * duplicate ticket set.
       */
      if (order.status === "paid") {
        return { outcome: "already_paid" as const, orderId };
      }

      /* ── 4. OUR RECORDS MUST AGREE WITH STRIPE'S ──────────────────────
       *
       * Three independent facts have to line up before money is recognised:
       * the session Stripe is telling us about, the amount it collected, and
       * the seats the order is actually for. Any disagreement is refused
       * rather than reconciled - a financial record that does not add up is
       * worse than one that is visibly missing, because nobody goes looking
       * for the second kind.
       */

      /* `stripeSessionId` is attached in a separate statement after the
         session is created (T27 step 6), so NULL is legitimate if an event
         somehow overtook that write - it is not evidence of anything. A
         non-null value that DISAGREES is, and is refused. */
      if (order.stripeSessionId !== null && order.stripeSessionId !== stripeSessionId) {
        return {
          outcome: "mismatch" as const,
          orderId,
          reason: `order.stripeSessionId ${order.stripeSessionId} != event session ${stripeSessionId}`,
        };
      }

      if (order.totalCents !== amountTotal) {
        return {
          outcome: "mismatch" as const,
          orderId,
          reason: `order.totalCents ${order.totalCents} != Stripe amount_total ${amountTotal}`,
        };
      }

      if (locked.some((s) => s.eventId !== order.eventId)) {
        return {
          outcome: "mismatch" as const,
          orderId,
          reason: "metadata.seatIds contains seats from another event",
        };
      }

      /* ── 5. CAN THESE SEATS STILL BE DELIVERED? ───────────────────────
       *
       * Checked under the locks from step 2, so the answer cannot change
       * underneath us. Two ways a seat is undeliverable:
       *
       *   - it is already SOLD (an order line exists)
       *   - a LIVE hold on it belongs to somebody else
       *
       * SHOULD BE UNREACHABLE, and it is worth being precise about why,
       * because the check is not ceremony. T27 extended this buyer's hold to
       * the exact instant their Stripe session expires, so for a stranger to
       * hold or buy this seat, that hold must have lapsed - and a lapsed hold
       * means a lapsed session, which Stripe will not accept a payment
       * against. The window is closed by construction.
       *
       * It is checked anyway because the cost of being wrong is asymmetric. If
       * this is ever reachable, the alternative to refusing is handing two
       * people a valid ticket to one seat - the single failure this entire
       * project exists to prevent. `one_sold_seat` and `tickets_seat_unique`
       * would still catch it at the insert, but a 23505 aborts the transaction
       * with nowhere to record WHY, and this path can mark the order and name
       * the seats for the refund.
       */
      const conflicts = await tx.execute<{
        id: string;
        sold: boolean;
        held_by: string | null;
      }>(sql`
        select
          st.id,
          ${seatIsSold(sql`st.id`)}    as sold,
          ${liveHoldOwner(sql`st.id`)} as held_by
        from ${seats} st
        where st.id in ${orderedSeatIds}
      `);

      const undeliverable = conflicts
        .filter((row) => row.sold || (row.held_by !== null && row.held_by !== order.userId))
        .map((row) => row.id)
        .sort();

      if (undeliverable.length > 0) {
        /* The customer has paid for something we cannot give them. Mark the
           order so it cannot be mistaken for fulfilled, and let the route log
           it as a refund-required incident. Committed deliberately: retrying
           cannot free a sold seat. */
        await tx.update(orders).set({ status: "failed" }).where(eq(orders.id, orderId));
        return { outcome: "seat_conflict" as const, orderId, seatIds: undeliverable };
      }

      /* ── 6. PRICES FROM `sections`, AND THEY MUST SUM TO WHAT WAS PAID ─
       *
       * `orderItems.priceCents` is the project's one deliberate
       * denormalisation (see schema.ts): a receipt must freeze what the
       * customer was charged, not follow a live price that the organizer can
       * change next week.
       *
       * Requiring the sum to equal `order.totalCents` - which step 4 already
       * tied to Stripe's `amount_total` - makes all three agree or none of
       * them commit. The invariant `scripts/check-seed.mjs` asserts ("orders
       * whose total <> sum of its items" must be 0) therefore cannot be
       * broken by this path.
       *
       * The trade-off is explicit: if an organizer edits a section price while
       * somebody is on the Stripe page, this refuses the payment instead of
       * recording a receipt whose lines do not add up to the charge. That is a
       * manual review by design. Silently writing either number would be a
       * financial record we could not defend.
       */
      const priced = await tx
        .select({ seatId: seats.id, priceCents: sections.priceCents })
        .from(seats)
        .innerJoin(sections, eq(sections.id, seats.sectionId))
        .where(inArray(seats.id, orderedSeatIds));

      const pricedTotal = priced.reduce((sum, row) => sum + row.priceCents, 0);
      if (pricedTotal !== order.totalCents) {
        return {
          outcome: "mismatch" as const,
          orderId,
          reason: `section prices now sum to ${pricedTotal} but the order was charged ${order.totalCents}`,
        };
      }

      /* ── 7. ORDER ITEMS - THE FINAL OVERSELL BACKSTOP ─────────────────
       *
       * This is the write that makes `one_sold_seat` mean something, and the
       * reason T27 deliberately did NOT do it: an order line is permanent, so
       * it may only be written once payment is confirmed. Everything before
       * this point in the customer's journey is reversible; this is not. It is
       * also what makes `seatIsSold()` - the definition of a taken seat
       * everywhere in the app - start returning true.
       */
      await tx.insert(orderItems).values(
        priced.map((row) => ({
          orderId,
          seatId: row.seatId,
          priceCents: row.priceCents,
        })),
      );

      /* ── 8. the render cache ──────────────────────────────────────────
       * Written, never read for a decision - schema.ts is explicit that
       * `seats.status` exists so a 288-seat map need not join two tables. */
      await tx
        .update(seats)
        .set({ status: "sold" })
        .where(inArray(seats.id, orderedSeatIds));

      /* ── 9. the holds have served their purpose ───────────────────────
       *
       * Scoped to THIS buyer's rows. A blanket release on these seat ids
       * would be wrong in a way that is easy to miss: if a stranger somehow
       * held one of them, releasing their live hold would hand their seat
       * away as a side effect of someone else's payment. Step 5 already
       * refuses that case - this is belt and braces, and it costs one clause.
       */
      const released = await tx
        .update(holds)
        .set({ releasedAt: sql`now()` })
        .where(
          and(
            inArray(holds.seatId, orderedSeatIds),
            eq(holds.userId, order.userId),
            isNull(holds.releasedAt),
          ),
        )
        .returning({ seatId: holds.seatId });

      /* ── 10. TICKETS, SIGNED ──────────────────────────────────────────
       *
       * The id is generated here rather than by the database because the
       * signature covers it: `signTicket(ticketId, orderId, seatId)` needs
       * the id before the row exists. Same approach `src/db/seed.ts` uses.
       *
       * A QR code is a picture of a string, so the payload cannot be trusted
       * on its own - the HMAC is what makes a ticket unforgeable without the
       * server's secret (see src/lib/qr.ts). `tickets_seat_unique` is the
       * third index standing between a retry and two valid tickets for one
       * seat.
       */
      const ticketRows = orderedSeatIds.map((seatId) => {
        const ticketId = randomUUID();
        return {
          id: ticketId,
          orderId,
          seatId,
          qrSignature: signTicket(ticketId, orderId, seatId),
        };
      });
      await tx.insert(tickets).values(ticketRows);

      /* ── 11. the order is paid ────────────────────────────────────────
       * Last, so that if anything above failed the order is never left
       * claiming a fulfilment that did not happen. */
      await tx.update(orders).set({ status: "paid" }).where(eq(orders.id, orderId));

      return {
        outcome: "fulfilled" as const,
        orderId,
        ticketCount: ticketRows.length,
        totalCents: order.totalCents,
        holdsReleased: released.length,
      };
    });
  } catch (error) {
    /* The gate fired: a concurrent or later delivery of an event already
       handled. Nothing was changed by this transaction. */
    if (isWebhookReplay(error)) return { outcome: "replayed" };
    /* Anything else is transient or unknown - rethrow so the route answers
       5xx and Stripe retries. */
    throw error;
  }
}

/* ── expiry ─────────────────────────────────────────────────────────────── */

/**
 * The buyer never paid and the Stripe session has expired.
 *
 * ── THIS IS HOUSEKEEPING, EXACTLY LIKE THE T25 CRON ────────────────────────
 * Nothing depends on it running. T27 pinned the hold's `expires_at` to the
 * session's, so by the time this event arrives the hold has ALREADY stopped
 * counting - `holdIsLive` fails on it, every availability query treats the seat
 * as free, and the seat map offers it again. That is T22, and it is what makes
 * the promise honest even if this handler never fires.
 *
 * What it adds is tidiness and an accurate order history: `released_at` gets
 * set, the stale `seats.status` is repaired, and the order stops sitting at
 * 'pending' forever pretending somebody might still pay it.
 */
export async function expireCheckoutSession({
  stripeEventId,
  orderId,
  seatIds,
}: {
  stripeEventId: string;
  orderId: string;
  seatIds: string[];
}): Promise<ExpireOutcome> {
  const orderedSeatIds = [...new Set(seatIds)].sort();

  try {
    return await db.transaction(async (tx) => {
      await tx.insert(webhookEvents).values({ stripeEventId });

      await tx
        .select({ id: seats.id })
        .from(seats)
        .where(inArray(seats.id, orderedSeatIds))
        .orderBy(seats.id)
        .for("update");

      const [order] = await tx
        .select({
          id: orders.id,
          userId: orders.userId,
          status: orders.status,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) return { outcome: "order_not_found" as const, orderId };

      /**
       * A paid order's seats are NEVER released by this path.
       *
       * Stripe can deliver events out of order, and a dashboard resend can
       * arrive long after the fact. Releasing here because an old `expired`
       * event showed up would take seats away from somebody who has a valid
       * ticket to them.
       */
      if (order.status === "paid") {
        return { outcome: "already_paid" as const, orderId };
      }

      await tx.update(orders).set({ status: "failed" }).where(eq(orders.id, orderId));

      /**
       * Only this buyer's ALREADY-EXPIRED holds.
       *
       * `expires_at <= now()` is the load-bearing clause. Without it, a buyer
       * who abandoned checkout and then came back and re-held the same seats
       * would have their NEW, live hold released by the arrival of the OLD
       * session's expiry event - the application quietly taking back seats the
       * user is actively holding. Scoping to the expired rows makes that
       * unrepresentable.
       */
      const released = await tx
        .update(holds)
        .set({ releasedAt: sql`now()` })
        .where(
          and(
            inArray(holds.seatId, orderedSeatIds),
            eq(holds.userId, order.userId),
            isNull(holds.releasedAt),
            lte(holds.expiresAt, sql`now()`),
          ),
        )
        .returning({ seatId: holds.seatId });

      /**
       * Repair the cache, guarded on BOTH sold and live-held.
       *
       * `repairSeatStatus` in queries/holds.ts guards only on sold, which is
       * correct there because that transaction has just released the hold it
       * is repairing. Here the hold may belong to a re-held seat that is
       * legitimately still 'held', so `seatHasLiveHold` has to be excluded too
       * or this would write a cache value that contradicts the source of
       * truth. The predicates are the shared fragments from
       * queries/availability.ts, so there is still exactly one definition of
       * each in the codebase.
       */
      const repaired = await tx.execute<{ id: string }>(sql`
        update ${seats} st
        set status = 'available'
        where st.id in ${orderedSeatIds}
          and st.status <> 'available'
          and not ${seatIsSold(sql`st.id`)}
          and not ${seatHasLiveHold(sql`st.id`)}
        returning st.id
      `);

      return {
        outcome: "expired" as const,
        orderId,
        holdsReleased: released.length,
        seatsRepaired: repaired.length,
      };
    });
  } catch (error) {
    if (isWebhookReplay(error)) return { outcome: "replayed" };
    throw error;
  }
}
