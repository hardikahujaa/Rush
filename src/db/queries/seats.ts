import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { liveHoldExpiry, seatStatusExpr } from "@/db/queries/availability";
import { seats, sections } from "@/db/schema";
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
 * are visually the same product rather than two that happen to share a navbar.
 */
const PALETTE = [
  TIER_COLORS.gold,
  TIER_COLORS.bronze,
  TIER_COLORS.slate,
  TIER_COLORS.violet,
];

type TierAccumulator = {
  id: string;
  name: string;
  priceCents: number;
  rowLabels: Set<string>;
  maxSeatNo: number;
  stats: { total: number; available: number; held: number; sold: number };
};

/**
 * Every seat for a real event, shaped exactly as the seat map already expects.
 *
 * ── ONE QUERY, AND THE COUNTS ARE THE SEATS ────────────────────────────────
 * This used to be two queries: one aggregating tier counts in SQL, one listing
 * per-seat statuses. They applied the same availability rule separately, and
 * separately is how they drifted - the per-seat `case` gave sold precedence over
 * held while the aggregate counted held without excluding sold, so one seat
 * could land in both buckets and `available + held + sold` could exceed the
 * number of seats in the room.
 *
 * Now the seat rows are fetched once and the tier totals are reduced from them.
 * The counts cannot disagree with the list because they are derived from it -
 * the bug is unrepresentable rather than fixed. It is also one round trip
 * instead of two, and the same shape `mock-data.ts` computes with `seatStats`,
 * so a database event and a mock event reach their numbers the same way.
 *
 * ── STATUS COMES FROM THE SOURCE OF TRUTH ──────────────────────────────────
 * `seatStatusExpr` reads `order_items` and live unexpired holds, never
 * `seats.status`. That is what makes expiry lazy: a hold past `expires_at`
 * stops counting the instant it passes, with no cron job and no write. It is
 * also the same definition `createHold` decides with, so the map cannot offer a
 * seat the API would refuse.
 *
 * Returns null for an event with no seats.
 */
export async function getSeatMapForEvent(
  eventId: string,
): Promise<SeatMapData | null> {
  const rows = await db.execute<{
    id: string;
    tier_id: string;
    row_label: string;
    seat_no: number;
    section_name: string;
    price_cents: number;
    status: SeatStatus;
    /* NOT `Date`. A raw `execute` bypasses Drizzle's column mapping, so a
       timestamptz arrives as a string (or null). Typing it as Date compiles and
       then throws on `.toISOString()` - the same trap documented in
       queries/holds.ts step 8 and queries/events.ts. */
    hold_expires_at: string | Date | null;
  }>(sql`
    select
      st.id,
      st.section_id  as tier_id,
      st.row_label,
      st.seat_no,
      sec.name       as section_name,
      sec.price_cents,
      ${seatStatusExpr(sql`st.id`)} as status,
      /* T33: the client needs this to expire a held seat locally, because a
         hold running out writes no row and so broadcasts nothing. */
      ${liveHoldExpiry(sql`st.id`)} as hold_expires_at
    from ${seats} st
    join ${sections} sec on sec.id = st.section_id
    where st.event_id = ${eventId}
    order by sec.price_cents desc, st.row_label, st.seat_no
  `);

  if (rows.length === 0) return null;

  /* A Map preserves insertion order, and the rows arrive most expensive first,
     so the tiers come out front-to-back without a second sort. */
  const byTier = new Map<string, TierAccumulator>();
  const seatList: Seat[] = [];

  for (const row of rows) {
    let tier = byTier.get(row.tier_id);
    if (!tier) {
      tier = {
        id: row.tier_id,
        name: row.section_name,
        priceCents: Number(row.price_cents),
        rowLabels: new Set(),
        maxSeatNo: 0,
        stats: { total: 0, available: 0, held: 0, sold: 0 },
      };
      byTier.set(row.tier_id, tier);
    }

    tier.rowLabels.add(row.row_label);
    if (row.seat_no > tier.maxSeatNo) tier.maxSeatNo = row.seat_no;
    tier.stats.total++;
    /* Exactly one bucket per seat - the status is a single value, so the three
       counts always sum to the total. */
    tier.stats[row.status]++;

    seatList.push({
      id: row.id,
      tierId: row.tier_id,
      row: row.row_label,
      number: row.seat_no,
      status: row.status,
      /* Only meaningful while the seat is held; null for everything else, so
         the client has nothing to misread on an available or sold seat. */
      holdExpiresAt:
        row.hold_expires_at === null
          ? null
          : new Date(row.hold_expires_at).toISOString(),
    });
  }

  return {
    /* Seeded events are Front / Middle / Rear facing a stage, which is a
       theatre. When venues gain a real type column this reads it instead. */
    venueType: "theater",
    tiers: [...byTier.values()].map((tier, index) => ({
      id: tier.id,
      name: tier.name,
      priceCents: tier.priceCents,
      color: PALETTE[index % PALETTE.length],
      rows: tier.rowLabels.size,
      seatsPerRow: tier.maxSeatNo,
      stats: tier.stats,
    })),
    seats: seatList,
  };
}
