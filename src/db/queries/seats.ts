import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { holds, orderItems, seats, sections } from "@/db/schema";
import {
  TIER_COLORS,
  type Seat,
  type SeatStatus,
  type TierWithStats,
  type VenueType,
} from "@/lib/mock-data";

export type SeatMapData = {
  venueType: VenueType;
  tiers: TierWithStats[];
  seats: Seat[];
};

/**
 * Tier colours in price order, most expensive first.
 *
 * The same four values the mock venues use, so a database event and a mock one
 * are visually the same product rather than two different ones that happen to
 * share a navbar.
 */
const PALETTE = [
  TIER_COLORS.gold,
  TIER_COLORS.bronze,
  TIER_COLORS.slate,
  TIER_COLORS.violet,
];

/**
 * Every seat for a real event, shaped exactly as the seat map already expects.
 *
 * ── WHY THIS IS A SOURCE SWAP AND NOT A REWRITE ────────────────────────────
 * `SeatMap` was deliberately written to receive `seats` as a prop and never to
 * generate them. So making a database event render is a matter of producing the
 * same shapes from Postgres - the component does not learn anything new, and
 * nothing about it changes.
 *
 * ── STATUS COMES FROM THE SOURCE OF TRUTH, NOT seats.status ────────────────
 * `seats.status` is a render cache and it lags: an expired hold leaves 'held'
 * behind until something clears it. Painting the map from the cache would show
 * seats as taken that anyone can actually buy - and worse, it would disagree
 * with the hold API, which decides from `order_items` and live holds. The map
 * and the transaction must answer "is this free?" the same way or the UI is
 * lying about what will happen when you click.
 */
export async function getSeatMapForEvent(
  eventId: string,
): Promise<SeatMapData | null> {
  const tierRows = await db.execute<{
    id: string;
    name: string;
    price_cents: number;
    row_count: number;
    seats_per_row: number;
    total: number;
    available: number;
    held: number;
    sold: number;
  }>(sql`
    select
      sec.id,
      sec.name,
      sec.price_cents,
      count(distinct st.row_label)::int                              as row_count,
      coalesce(max(st.seat_no), 0)::int                              as seats_per_row,
      count(st.id)::int                                              as total,
      count(st.id) filter (
        where not exists (select 1 from ${orderItems} oi where oi.seat_id = st.id)
          and not exists (
            select 1 from ${holds} h
            where h.seat_id = st.id and h.released_at is null and h.expires_at > now()
          )
      )::int                                                          as available,
      count(st.id) filter (
        where exists (
          select 1 from ${holds} h
          where h.seat_id = st.id and h.released_at is null and h.expires_at > now()
        )
      )::int                                                          as held,
      count(st.id) filter (
        where exists (select 1 from ${orderItems} oi where oi.seat_id = st.id)
      )::int                                                          as sold
    from ${sections} sec
    left join ${seats} st on st.section_id = sec.id
    where sec.event_id = ${eventId}
    group by sec.id, sec.name, sec.price_cents
    order by sec.price_cents desc
  `);

  if (tierRows.length === 0) return null;

  const seatRows = await db.execute<{
    id: string;
    tier_id: string;
    row_label: string;
    seat_no: number;
    status: SeatStatus;
  }>(sql`
    select
      st.id,
      st.section_id as tier_id,
      st.row_label,
      st.seat_no,
      case
        when exists (select 1 from ${orderItems} oi where oi.seat_id = st.id)
          then 'sold'
        when exists (
          select 1 from ${holds} h
          where h.seat_id = st.id and h.released_at is null and h.expires_at > now()
        ) then 'held'
        else 'available'
      end as status
    from ${seats} st
    join ${sections} sec on sec.id = st.section_id
    where st.event_id = ${eventId}
    order by sec.price_cents desc, st.row_label, st.seat_no
  `);

  return {
    /* Seeded events are Front / Middle / Rear facing a stage, which is a
       theatre. When venues gain a real type column this reads it instead. */
    venueType: "theater",
    tiers: tierRows.map((tier, index) => ({
      id: tier.id,
      name: tier.name,
      priceCents: tier.price_cents,
      color: PALETTE[index % PALETTE.length],
      rows: tier.row_count,
      seatsPerRow: tier.seats_per_row,
      stats: {
        total: tier.total,
        available: tier.available,
        held: tier.held,
        sold: tier.sold,
      },
    })),
    seats: seatRows.map((seat) => ({
      id: seat.id,
      tierId: seat.tier_id,
      row: seat.row_label,
      number: seat.seat_no,
      status: seat.status,
    })),
  };
}
