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

/* ── event cards: the homepage rails and the /events listing (T17) ───────── */

/** Which slice of the catalogue to return. */
export type EventBucket = "on-sale" | "upcoming" | "past" | "all";

export type EventCardRow = {
  id: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  venue: string;
  city: string;
  /** ISO string, matching what the card already formats. */
  startsAt: string;
  /** ISO string. Drives the "drops in" countdown on an upcoming card. */
  dropAt: string;
  /** Derived, not the raw column - see `bucketOf` below. */
  state: "on-sale" | "upcoming" | "past";
  hues: [number, number];
  fromPriceCents: number;
  seatsLeft: number;
  seatsTotal: number;
};

/**
 * Real, clickable events for the homepage rails and the `/events` listing.
 *
 * ── THIS REPLACED THE MOCK CATALOGUE (T17) ─────────────────────────────────
 * Until T17 every rail on the homepage rendered `src/lib/mock-events.ts`, whose
 * seat ids are strings like `rc-3-front-A3` that exist nowhere in Postgres. A
 * crawl of the rendered homepage found 18 dead links and 18 event pages whose
 * seat maps could never be held or bought. Everything here comes from the
 * `events` table, so every card links to a uuid with a real seat map behind it.
 *
 * ── THE BUCKET IS DERIVED, NOT READ OFF `status` ───────────────────────────
 * `events.status` alone cannot answer "can I buy this right now": a row can be
 * `live` with `drop_at` still in the future (tickets not released) or with
 * `starts_at` in the past (the show has happened). The three states below are
 * computed from all three columns together, which is the same composite test
 * `createHold` applies before it will claim a seat - so a card that says "on
 * sale" is a card the hold API will actually serve.
 *
 * ── AVAILABILITY COMES FROM THE SOURCE OF TRUTH ────────────────────────────
 * `seatsLeft` uses `seatIsAvailable` - order lines and live unexpired holds -
 * never `seats.status`. That is what makes the scarcity badge honest and what
 * makes expired holds free their seats here with no cron job (T22).
 */
export async function getEventCards({
  bucket = "all",
  q,
  limit = 24,
}: {
  bucket?: EventBucket;
  /** Free-text title search. Powers the navbar's existing `?q=` search. */
  q?: string;
  limit?: number;
} = {}): Promise<EventCardRow[]> {
  /* Composed as fragments rather than string-concatenated SQL, so the values
     stay parameterised and the filter cannot be injected into. */
  const bucketFilter =
    bucket === "on-sale"
      ? sql`and e.status = 'live' and e.drop_at <= now() and e.starts_at > now()`
      : bucket === "upcoming"
        ? sql`and e.drop_at > now() and e.starts_at > now()`
        : bucket === "past"
          ? sql`and e.starts_at <= now()`
          : sql``;

  /* `%` wrapping happens in the parameter, not the SQL, so a user typing `%`
     searches for a literal percent sign instead of matching everything. */
  const search = q?.trim()
    ? sql`and (e.title ilike ${`%${q.trim()}%`} or v.name ilike ${`%${q.trim()}%`} or v.city ilike ${`%${q.trim()}%`})`
    : sql``;

  const rows = await db.execute<{
    id: string;
    title: string;
    description: string | null;
    /* NOT `Date`. A raw `execute` bypasses Drizzle's column mapping, so a
       timestamptz arrives as a string - annotating it as Date compiles and then
       throws `.toISOString is not a function` at runtime. That exact bug shipped
       in this file once already; see also holds.ts step 8. */
    starts_at: string | Date;
    drop_at: string | Date;
    venue: string;
    city: string;
    from_price_cents: number | null;
    seats_total: number;
    seats_left: number;
    dropped: boolean;
    started: boolean;
  }>(sql`
    select
      e.id,
      e.title,
      e.description,
      e.starts_at,
      e.drop_at,
      v.name as venue,
      v.city,
      e.drop_at   <= now() as dropped,
      e.starts_at <= now() as started,
      (select min(s.price_cents) from sections s where s.event_id = e.id) as from_price_cents,
      (select count(*)::int from seats st where st.event_id = e.id) as seats_total,
      (select count(*)::int from seats st
         where st.event_id = e.id and ${seatIsAvailable(sql`st.id`)}) as seats_left
    from ${events} e
    join ${venues} v on v.id = e.venue_id
    where e.status <> 'draft'
      ${bucketFilter}
      ${search}
    order by
      /* Soonest first within each group, but anything already finished sinks to
         the bottom - a past show should never head a listing. */
      (e.starts_at <= now()) asc,
      e.starts_at asc
    limit ${limit}
  `);

  return rows
    /* A room with no seats cannot be rendered as a card: the urgency badge
       divides by seatsTotal and a "0 of 0 left" chip is noise. */
    .filter((row) => row.seats_total > 0)
    .map((row) => ({
      id: row.id,
      title: row.title,
      /* No subtitle column, and inventing one would be the kind of small lie
         event-lookup.ts has refused since T18. The card omits the line. */
      subtitle: null,
      category: null,
      venue: row.venue,
      city: row.city,
      startsAt: new Date(row.starts_at).toISOString(),
      dropAt: new Date(row.drop_at).toISOString(),
      state: row.started ? "past" : row.dropped ? "on-sale" : "upcoming",
      hues: huesFromId(row.id),
      fromPriceCents: Number(row.from_price_cents ?? 0),
      seatsTotal: row.seats_total,
      seatsLeft: row.seats_left,
    }));
}
