import "server-only";

import { and, asc, desc, eq, gt, lte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { seatIsAvailable } from "@/db/queries/availability";
import { events, venues } from "@/db/schema";

export type NextDrop = {
  id: string;
  title: string;
  venue: string;
  city: string;
  dropAt: Date;
  /** true when the drop has already happened and tickets are buyable now. */
  isLive: boolean;
};

/**
 * The single most interesting event right now, for the navbar ticker.
 *
 * Two passes rather than one clever query, because "next" means two different
 * things and collapsing them would give the wrong answer:
 *
 *   1. A drop that has NOT happened yet - the countdown case. Soonest first.
 *   2. Failing that, something already on sale - the "buy now" case. Most
 *      recently dropped first, since that is the one people are still rushing.
 *
 * Returns null when neither exists, and the ticker simply renders nothing.
 */
export async function getNextDrop(): Promise<NextDrop | null> {
  const now = new Date();

  const upcoming = await db
    .select({
      id: events.id,
      title: events.title,
      venue: venues.name,
      city: venues.city,
      dropAt: events.dropAt,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(ne(events.status, "ended"), gt(events.dropAt, now)))
    .orderBy(asc(events.dropAt))
    .limit(1);

  if (upcoming[0]) return { ...upcoming[0], isLive: false };

  const live = await db
    .select({
      id: events.id,
      title: events.title,
      venue: venues.name,
      city: venues.city,
      dropAt: events.dropAt,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(events.status, "live"), lte(events.dropAt, now)))
    .orderBy(desc(events.dropAt))
    .limit(1);

  return live[0] ? { ...live[0], isLive: true } : null;
}

export type EventSection = {
  id: string;
  name: string;
  priceCents: number;
  seatsTotal: number;
  seatsLeft: number;
};

export type EventDetail = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  venue: string;
  city: string;
  startsAt: Date;
  dropAt: Date;
  status: "draft" | "scheduled" | "live" | "ended";
  /** Two oklch hues in the gold band, for the generated poster. */
  hues: [number, number];
  sections: EventSection[];
  /** Where this record came from, so the page can be honest about it. */
  source: "database" | "mock";
};

/**
 * Deterministic poster hues for a database event.
 *
 * The schema has no artwork column, so the two hues are derived from the id
 * itself. Deterministic rather than random because the poster must not change
 * between a server render and a client navigation - and the same event must look
 * the same on the card and on its detail page.
 *
 * Both land inside the 45-95 gold band, so a generated poster can never leave
 * the Obsidian/Champagne palette.
 */
function huesFromId(id: string): [number, number] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const a = 45 + (Math.abs(hash) % 51);
  const b = 45 + (Math.abs(hash >> 8) % 51);
  return [a, b];
}

/**
 * One event with its venue and priced sections, including live availability.
 *
 * Availability is computed from the SOURCE OF TRUTH, not from `seats.status`.
 * A seat counts as available when no order item claims it and no unexpired,
 * unreleased hold covers it. That is the same definition the hold API will use
 * in T20, so the number on this page cannot disagree with the number the
 * checkout enforces - and expired holds free their seats here with no cron job,
 * which is the lazy expiry T22 is about.
 *
 * Returns null for an unknown id so the caller can call notFound().
 */
export async function getEventById(id: string): Promise<EventDetail | null> {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      startsAt: events.startsAt,
      dropAt: events.dropAt,
      status: events.status,
      venue: venues.name,
      city: venues.city,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(eq(events.id, id))
    .limit(1);

  const event = rows[0];
  if (!event) return null;

  const sectionRows = await db.execute(sql`
    select
      s.id,
      s.name,
      s.price_cents as "priceCents",
      count(st.id)::int as "seatsTotal",
      count(st.id) filter (where ${seatIsAvailable(sql`st.id`)})::int as "seatsLeft"
    from sections s
    left join seats st on st.section_id = s.id
    where s.event_id = ${id}
    group by s.id, s.name, s.price_cents
    order by s.price_cents desc
  `);

  return {
    ...event,
    subtitle: null,
    hues: huesFromId(event.id),
    sections: sectionRows as unknown as EventSection[],
    source: "database",
  };
}
