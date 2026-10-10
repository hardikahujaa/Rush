import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdIsLive } from "@/db/queries/availability";
import type { EventQueueInfo } from "@/db/queries/events";
import { CHECKOUT_BUFFER_SECONDS, CHECKOUT_WINDOW_MINUTES } from "@/db/queries/orders";
import { events, holds, orders, seats } from "@/db/schema";

/**
 * Is this user already past the queue, by virtue of having business in flight?
 *
 * ── THE BUG THIS EXISTS TO PREVENT ─────────────────────────────────────────
 * Admission is a twenty-minute pass. Checkout can legitimately take longer:
 * `createPendingOrder` extends the caller's holds to 30 minutes plus a 60
 * second buffer, matching the Stripe session's own expiry. So there is a window
 * - roughly ten minutes wide - in which a user has a live hold, a pending
 * order, and an admission cookie that has just expired.
 *
 * Without this check, what happens to them is the worst outcome the feature can
 * produce: they finish paying on Stripe, Stripe redirects them back, the gate
 * sees no valid admission and sends them to the BACK OF A QUEUE - while holding
 * seats they have already paid for. They would watch their own hold expire from
 * inside a waiting room.
 *
 * Stretching the admission TTL past 31 minutes would "fix" it and break the
 * feature instead: a pass long enough to outlive every possible checkout stops
 * being a throttle. The pass stays short; this query covers the overhang.
 *
 * ── WHY THIS IS NOT A BYPASS ───────────────────────────────────────────────
 * It grants nothing a user could not already do. Both branches require a row
 * that only the hold transaction or the checkout transaction can create, and
 * both of those run BEHIND the gate. You cannot acquire a live hold without
 * having been admitted, so you cannot use this to get admitted. It recognises
 * people who are already inside; it does not let anybody in.
 *
 * ── ONE QUERY, TWO EXISTS, SHORT-CIRCUITED ─────────────────────────────────
 * `or` in Postgres evaluates lazily, so the common case - a live hold, which is
 * the cheaper lookup - usually answers without touching `orders` at all. One
 * round trip either way, because this runs on every seat-map render during a
 * drop and two round trips there would be two too many.
 */
export async function hasBusinessInFlight(
  userId: string,
  eventId: string,
): Promise<boolean> {
  /* The pending-order branch is time-bounded by `created_at`, because `orders`
     has no expiry column of its own - the hold it extended is what expires.
     The bound is therefore the same number checkout used, so the exemption
     cannot outlive the Stripe session it is covering. */
  const staleAfter = `${CHECKOUT_WINDOW_MINUTES} minutes ${CHECKOUT_BUFFER_SECONDS} seconds`;

  const rows = await db.execute<{ exempt: boolean }>(sql`
    select
      exists (
        select 1
          from ${holds} h
          join ${seats} s on s.id = h.seat_id
         where h.user_id = ${userId}
           and s.event_id = ${eventId}
           and ${holdIsLive(sql`h`)}
      )
      or exists (
        select 1
          from ${orders} o
         where o.user_id = ${userId}
           and o.event_id = ${eventId}
           and o.status = 'pending'
           and o.created_at > now() - ${sql.raw(`interval '${staleAfter}'`)}
      ) as exempt`);

  /* `db.execute` bypasses Drizzle's column mapping, so the value arrives as
     whatever the driver produced rather than a guaranteed boolean - the same
     trap that turned a `Date` column into a string in `getLiveEvents`. */
  return rows[0]?.exempt === true;
}

/**
 * Which event do these seats belong to?
 *
 * ── WHY `/api/holds` NEEDS THIS AT ALL ─────────────────────────────────────
 * The gate is defined per event, and the hold endpoint's contract is a list of
 * SEAT ids - it never receives an event id. The obvious fix is to have the
 * client send one, and that is exactly the wrong fix: the gate would then be
 * checking an event the caller chose rather than the one the seats are in, so
 * naming a quiet event would unlock holds on the busy one. The event has to be
 * derived from the seats, server-side, every time.
 *
 * One query, not two: `selectDistinct` over the join collapses to a single row
 * when every seat shares an event, which is the only case a hold is legal in
 * anyway.
 *
 * Returns null when the seats span several events or do not exist. The caller
 * SKIPS the gate in that case, which is safe rather than a loophole: the hold
 * transaction refuses both of those requests on its own (`MIXED_EVENTS`,
 * `SEATS_NOT_FOUND`), so there is no hold to protect - and refusing here
 * instead would replace an accurate error with a misleading one about a queue.
 */
export async function getEventForSeats(
  seatIds: string[],
): Promise<EventQueueInfo | null> {
  if (seatIds.length === 0) return null;

  const rows = await db
    .selectDistinct({
      id: events.id,
      title: events.title,
      dropAt: events.dropAt,
      status: events.status,
    })
    .from(seats)
    .innerJoin(events, eq(events.id, seats.eventId))
    .where(inArray(seats.id, seatIds));

  return rows.length === 1 ? rows[0] : null;
}
