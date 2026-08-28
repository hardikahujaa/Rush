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

/** Rs 4,999 from 499900. Grouped in the Indian system. */
export function formatPaise(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

const RAW_SELLING_FAST: RawMockEvent[] = [
  {
    id: "sf-1",
    title: "Midnight Circuit",
    subtitle: "The Closing Night",
    category: "Live Concerts",
    venue: "Nehru Indoor Stadium",
    city: "Chennai",
    startsAt: "2026-09-04T19:30:00+05:30",
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
    startsAt: "2026-09-11T20:00:00+05:30",
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
    startsAt: "2026-09-06T19:00:00+05:30",
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
    startsAt: "2026-09-19T19:45:00+05:30",
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
    startsAt: "2026-09-27T16:00:00+05:30",
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
    startsAt: "2026-09-02T21:15:00+05:30",
    hues: [55, 95],
  },
  {
    id: "rc-3",
    title: "Carnatic After Dark",
    subtitle: "Late Recital Series",
    category: "Live Concerts",
    venue: "Music Academy",
    city: "Chennai",
    startsAt: "2026-09-14T21:00:00+05:30",
    hues: [88, 55],
  },
  {
    id: "rc-4",
    title: "Analogue Darkroom",
    subtitle: "Two-Day Intensive",
    category: "Workshops",
    venue: "Studio 41",
    city: "Chennai",
    startsAt: "2026-09-21T10:00:00+05:30",
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
    startsAt: "2026-09-08T20:30:00+05:30",
    hues: [75, 95],
  },
  {
    id: "cm-2",
    title: "Nothing Personal",
    subtitle: "Improv Collective",
    category: "Comedy & Theater",
    venue: "The Cuckoo Club",
    city: "Mumbai",
    startsAt: "2026-09-13T21:00:00+05:30",
    hues: [45, 75],
  },
  {
    id: "cm-3",
    title: "Second Draft",
    subtitle: "New Material Night",
    category: "Comedy & Theater",
    venue: "Courtyard",
    city: "Bengaluru",
    startsAt: "2026-09-17T20:00:00+05:30",
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
    startsAt: "2026-09-05T18:45:00+05:30",
    hues: [95, 55],
  },
  {
    id: "mv-2",
    title: "Kalki 3898",
    subtitle: "Re-release, Dolby Atmos",
    category: "Movies",
    venue: "AMB Cinemas",
    city: "Hyderabad",
    startsAt: "2026-09-09T22:00:00+05:30",
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
    startsAt: "2026-09-15T19:00:00+05:30",
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
    dropAt: "2026-09-01T11:00:00+05:30",
    hues: [88, 62],
  },
  {
    id: "up-2",
    title: "The Ninth Hour",
    subtitle: "National Tour",
    category: "Comedy & Theater",
    city: "New Delhi",
    dropAt: "2026-09-03T12:00:00+05:30",
    hues: [75, 45],
  },
  {
    id: "up-3",
    title: "Grand Prix Weekend",
    subtitle: "Three-Day Paddock",
    category: "Sports",
    city: "Hyderabad",
    dropAt: "2026-09-08T09:00:00+05:30",
    hues: [62, 88],
  },
  {
    id: "up-4",
    title: "Monsoon Palette",
    subtitle: "Immersive Installation",
    category: "Experiences & Fests",
    city: "Pune",
    dropAt: "2026-09-12T18:00:00+05:30",
    hues: [95, 45],
  },
];
