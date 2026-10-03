import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  events,
  orderItems,
  orders,
  seats,
  sections,
  tickets,
  venues,
} from "@/db/schema";

export type TicketLine = {
  ticketId: string;
  orderId: string;
  seatId: string;
  sectionName: string;
  rowLabel: string;
  seatNo: number;
  priceCents: number;
  /** Null until somebody walks through the gate. Set exactly once, in T31. */
  checkedInAt: Date | null;
};

export type TicketGroup = {
  eventId: string;
  eventTitle: string;
  venueName: string;
  venueCity: string;
  startsAt: Date;
  tickets: TicketLine[];
};

/**
 * Every ticket this user actually owns, grouped by event.
 *
 * ── TWO RULES, BOTH IN THE WHERE CLAUSE ────────────────────────────────────
 *   `orders.user_id = $me`        - it is theirs
 *   `orders.status  = 'paid'`     - it was paid for
 *
 * Neither is a branch in the page. Same reasoning as `getOrderForUser` in T29
 * and `releaseHolds` in T25: a row that fails either test does not match, so
 * there is no `if` for a later edit to delete and no gap between reading and
 * deciding.
 *
 * The paid filter is not redundant with the webhook. `tickets` rows are only
 * ever created by T28 at confirmed payment, so in principle every ticket
 * belongs to a paid order - but "in principle" is doing a lot of work in a
 * sentence about issuing entry credentials. If a refund flow later sets an
 * order to `refunded` without deleting its tickets, this query stops handing
 * out QR codes for it on that same day, with no change here.
 *
 * ── WHY IT JOINS order_items AT ALL ────────────────────────────────────────
 * `priceCents` is read from `order_items`, not from `sections`. The order line
 * is the frozen historical record of what the customer was charged (see the
 * note in schema.ts); `sections.price_cents` is live and the organizer can
 * change it. A ticket should show what was paid, not what the seat costs today.
 *
 * Ordered by event date, then by price and seat, so the grouping below comes
 * out stable and the most expensive seats lead each event - the same ordering
 * the seat map and the success page use.
 */
export async function getTicketsForUser(userId: string): Promise<TicketGroup[]> {
  const rows = await db
    .select({
      ticketId: tickets.id,
      orderId: tickets.orderId,
      seatId: tickets.seatId,
      checkedInAt: tickets.checkedInAt,
      sectionName: sections.name,
      rowLabel: seats.rowLabel,
      seatNo: seats.seatNo,
      priceCents: orderItems.priceCents,
      eventId: events.id,
      eventTitle: events.title,
      venueName: venues.name,
      venueCity: venues.city,
      startsAt: events.startsAt,
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(seats, eq(seats.id, tickets.seatId))
    .innerJoin(sections, eq(sections.id, seats.sectionId))
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    /* The price the customer was actually charged, from the order line that
       was written alongside this ticket in the same transaction. */
    .innerJoin(
      orderItems,
      and(
        eq(orderItems.orderId, tickets.orderId),
        eq(orderItems.seatId, tickets.seatId),
      ),
    )
    .where(and(eq(orders.userId, userId), eq(orders.status, "paid")))
    .orderBy(asc(events.startsAt), asc(sections.priceCents), asc(seats.rowLabel), asc(seats.seatNo));

  /* Grouped in JS from one query rather than queried per event. A Map keeps
     insertion order, and the rows already arrive sorted by event date, so the
     groups come out chronological without a second sort - the same technique
     getSeatMapForEvent uses for its tiers. */
  const byEvent = new Map<string, TicketGroup>();

  for (const row of rows) {
    let group = byEvent.get(row.eventId);
    if (!group) {
      group = {
        eventId: row.eventId,
        eventTitle: row.eventTitle,
        venueName: row.venueName,
        venueCity: row.venueCity,
        startsAt: row.startsAt,
        tickets: [],
      };
      byEvent.set(row.eventId, group);
    }

    group.tickets.push({
      ticketId: row.ticketId,
      orderId: row.orderId,
      seatId: row.seatId,
      sectionName: row.sectionName,
      rowLabel: row.rowLabel,
      seatNo: row.seatNo,
      priceCents: row.priceCents,
      checkedInAt: row.checkedInAt,
    });
  }

  return [...byEvent.values()];
}
