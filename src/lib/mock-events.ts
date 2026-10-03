import "server-only";

/**
 * Mock event data for the homepage rails.
 *
 * MOCK. The database holds three real seeded events; these are placeholders so
 * the layout can be built and reviewed at realistic density before T17 wires the
 * rails to `src/db/queries/events.ts`.
 *
 * ── PRESENTATION LIVES HERE. NUMBERS DO NOT. ───────────────────────────────
 * These records carry a title, a venue name, two hues - the things a card shows
 * that no seat can tell you. Every *quantity* (seats left, seats total, from
 * price) is computed from `mock-data.ts`, which owns the physical grid.
 *
 * Storing those numbers here as literals is what allowed a card to advertise
 * twelve seats while the seat map held nine. Deriving them makes that class of
 * bug unrepresentable rather than merely fixed: there is no second copy left to
 * fall out of date.
 *
 * Two rules kept deliberately, so swapping in real data changes nothing visually:
 *   - prices are integer paise, exactly as `sections.price_cents` stores them
 *   - the derived fields have the same names and shapes the real availability
 *     query returns, so the urgency badge needs no new field
 */

import { fromPrice, seatStats } from "@/lib/mock-data";

/** What is authored by hand: everything a seat cannot tell you. */
type RawMockEvent = {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  venue: string;
  city: string;
  /** ISO date string. */
  startsAt: string;
  /** Two oklch hues used for the card's generated artwork. */
  hues: [number, number];
  tag?: "trending" | "just-announced" | "final-release";
};

/** What the UI consumes: the authored fields plus the computed ones. */
export type MockEvent = RawMockEvent & {
  /** Paise. 499900 = Rs 4,999. Cheapest tier in the venue. */
  fromPriceCents: number;
  seatsLeft: number;
  seatsTotal: number;
};

/**
 * A demo date, N days from now, at a fixed IST wall-clock time.
 *
 * ── WHY THESE ARE NOT LITERAL STRINGS ANY MORE ─────────────────────────────
 * They used to be hardcoded as "2026-09-14T21:00:00+05:30" and friends. That is
 * fine on the day it is written and quietly wrong a month later: by October the
 * entire homepage was advertising shows that had already happened, and the
 * detail page's countdown had nothing to count down to. A demo whose dates rot
 * is a demo that stops demonstrating.
 *
 * The day-of-month from the old literal becomes the offset, so the original
 * spacing and ordering of the rails is preserved exactly - rc-3 was the 14th,
 * so it is now 14 days out.
 *
 * ── WHY THIS MODULE IS `server-only` ──────────────────────────────────────
 * `Date.now()` at module scope is evaluated wherever the module is loaded. Seven
 * CLIENT components used to import `formatPaise` from this file, which would
 * have meant the browser computing its own "now" and rendering a date the server
 * disagreed with - a hydration mismatch straddling midnight, on the one value a
 * ticketing product must not get wrong. `formatPaise` now lives in
 * `src/lib/format.ts`, and the `server-only` import at the top of this file
 * turns any future client import into a build error instead of a silent bug.
 */
function inDays(days: number, istTime: string): string {
  const target = new Date(Date.now() + days * 86_400_000);
  /* en-CA formats as YYYY-MM-DD, and the IST timezone is applied before the
     date is read - so the calendar day is the one a viewer in India sees, not
     the server's UTC day. */
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
  return `${ymd}T${istTime}:00+05:30`;
}

const RAW_SELLING_FAST: RawMockEvent[] = [
  {
    id: "sf-1",
    title: "Midnight Circuit",
    subtitle: "The Closing Night",
    category: "Live Concerts",
    venue: "Nehru Indoor Stadium",
    city: "Chennai",
    startsAt: inDays(4, "19:30"),
    hues: [95, 88],
    tag: "final-release",
  },
  {
    id: "sf-2",
    title: "Anantara",
    subtitle: "Unplugged, One Night",
    category: "Live Concerts",
    venue: "Jio World Garden",
    city: "Mumbai",
    startsAt: inDays(11, "20:00"),
    hues: [88, 62],
    tag: "trending",
  },
  {
    id: "sf-3",
    title: "The Long Con",
    subtitle: "Stand-Up Special",
    category: "Comedy & Theater",
    venue: "Ranga Shankara",
    city: "Bengaluru",
    startsAt: inDays(6, "19:00"),
    hues: [75, 45],
    tag: "final-release",
  },
  {
    id: "sf-4",
    title: "Derby Night",
    subtitle: "Matchday 14",
    category: "Sports",
    venue: "Salt Lake Stadium",
    city: "Kolkata",
    startsAt: inDays(19, "19:45"),
    hues: [62, 88],
    tag: "trending",
  },
];

const RAW_RECOMMENDED: RawMockEvent[] = [
  {
    id: "rc-1",
    title: "NEON/NOISE",
    subtitle: "Night One",
    category: "Experiences & Fests",
    venue: "Island Grounds",
    city: "Chennai",
    startsAt: inDays(27, "16:00"),
    hues: [95, 45],
    tag: "trending",
  },
  {
    id: "rc-2",
    title: "Dune: Part Three",
    subtitle: "IMAX 70mm",
    category: "Movies",
    venue: "Sathyam Cinemas",
    city: "Chennai",
    startsAt: inDays(2, "21:15"),
    hues: [55, 95],
  },
  {
    id: "rc-3",
    title: "Carnatic After Dark",
    subtitle: "Late Recital Series",
    category: "Live Concerts",
    venue: "Music Academy",
    city: "Chennai",
    startsAt: inDays(14, "21:00"),
    hues: [88, 55],
  },
  {
    id: "rc-4",
    title: "Analogue Darkroom",
    subtitle: "Two-Day Intensive",
    category: "Workshops",
    venue: "Studio 41",
    city: "Chennai",
    startsAt: inDays(21, "10:00"),
    hues: [55, 75],
    tag: "final-release",
  },
];

const RAW_SPOTLIGHT_COMEDY: RawMockEvent[] = [
  {
    id: "cm-1",
    title: "Room Temperature",
    subtitle: "A Live Taping",
    category: "Comedy & Theater",
    venue: "Prithvi Theatre",
    city: "Mumbai",
    startsAt: inDays(8, "20:30"),
    hues: [75, 95],
  },
  {
    id: "cm-2",
    title: "Nothing Personal",
    subtitle: "Improv Collective",
    category: "Comedy & Theater",
    venue: "The Cuckoo Club",
    city: "Mumbai",
    startsAt: inDays(13, "21:00"),
    hues: [45, 75],
  },
  {
    id: "cm-3",
    title: "Second Draft",
    subtitle: "New Material Night",
    category: "Comedy & Theater",
    venue: "Courtyard",
    city: "Bengaluru",
    startsAt: inDays(17, "20:00"),
    hues: [62, 75],
  },
];

const RAW_SPOTLIGHT_MOVIES: RawMockEvent[] = [
  {
    id: "mv-1",
    title: "The Silent Coast",
    subtitle: "Director's Cut, 4K",
    category: "Movies",
    venue: "PVR Icon",
    city: "Bengaluru",
    startsAt: inDays(5, "18:45"),
    hues: [95, 55],
  },
  {
    id: "mv-2",
    title: "Kalki 3898",
    subtitle: "Re-release, Dolby Atmos",
    category: "Movies",
    venue: "AMB Cinemas",
    city: "Hyderabad",
    startsAt: inDays(9, "22:00"),
    hues: [45, 95],
    tag: "final-release",
  },
  {
    id: "mv-3",
    title: "Rear Window",
    subtitle: "Restored on 35mm",
    category: "Movies",
    venue: "Regal Cinema",
    city: "Mumbai",
    startsAt: inDays(15, "19:00"),
    hues: [88, 55],
  },
];

/**
 * Join an authored record to the live numbers from its physical grid.
 *
 * This is the ONLY place a mock event acquires a quantity. Every rail, card and
 * badge downstream reads the result, so the landing page and the seat map are
 * reading the same `seats` array through two different shapes of the same
 * question - not two numbers that happen to have been typed to match.
 *
 * An event with no venue defined falls back to zeroes rather than throwing: a
 * card that renders "sold out" is recoverable, a homepage that 500s is not.
 */
function withLiveCounts(event: RawMockEvent): MockEvent {
  const stats = seatStats(event.id);
  return {
    ...event,
    fromPriceCents: fromPrice(event.id) ?? 0,
    seatsLeft: stats.available,
    seatsTotal: stats.total,
  };
}

export const SELLING_FAST: MockEvent[] = RAW_SELLING_FAST.map(withLiveCounts);
export const RECOMMENDED: MockEvent[] = RAW_RECOMMENDED.map(withLiveCounts);
export const SPOTLIGHT_COMEDY: MockEvent[] = RAW_SPOTLIGHT_COMEDY.map(withLiveCounts);
export const SPOTLIGHT_MOVIES: MockEvent[] = RAW_SPOTLIGHT_MOVIES.map(withLiveCounts);

export type UpcomingEvent = {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  city: string;
  /** ISO string for when tickets are released, not when the show is. */
  dropAt: string;
  hues: [number, number];
};

export const UPCOMING: UpcomingEvent[] = [
  {
    id: "up-1",
    title: "Aurora Sessions",
    subtitle: "Winter Residency",
    category: "Live Concerts",
    city: "Goa",
    dropAt: inDays(1, "11:00"),
    hues: [88, 62],
  },
  {
    id: "up-2",
    title: "The Ninth Hour",
    subtitle: "National Tour",
    category: "Comedy & Theater",
    city: "New Delhi",
    dropAt: inDays(3, "12:00"),
    hues: [75, 45],
  },
  {
    id: "up-3",
    title: "Grand Prix Weekend",
    subtitle: "Three-Day Paddock",
    category: "Sports",
    city: "Hyderabad",
    dropAt: inDays(8, "09:00"),
    hues: [62, 88],
  },
  {
    id: "up-4",
    title: "Monsoon Palette",
    subtitle: "Immersive Installation",
    category: "Experiences & Fests",
    city: "Pune",
    dropAt: inDays(12, "18:00"),
    hues: [95, 45],
  },
];
