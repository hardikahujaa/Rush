/**
 * THE SINGLE SOURCE OF SEAT TRUTH.
 *
 * Every seat count and every price anywhere in the app - the "Only 12 seats
 * left" badge on a landing card, the "38 of 226 seats available" row in the T18
 * pricing table, the tier legend above the seat map - is produced by filtering
 * or reducing the array this file builds. Nothing downstream stores its own
 * number, so nothing downstream can drift out of step with the physical grid.
 *
 * ── WHY A SEEDED PRNG AND NEVER Math.random ────────────────────────────────
 * Statuses have to be scattered so the map reads like a real house rather than a
 * solid block of sold seats at the front. But `Math.random()` would produce a
 * different scatter on the server than on the client, which is a hydration
 * mismatch, AND a different scatter on every reload, so the number in the badge
 * would change while the user watched it. A PRNG seeded from the event id gives
 * a scatter that is arbitrary-looking but identical everywhere, forever.
 *
 * ── WHY availableTarget IS EXACT, NOT A PROBABILITY ────────────────────────
 * The generator marks exactly the number of seats it is told to. A per-seat
 * probability would land near the target and miss it, so a card promising 12
 * seats could open a map holding 9. The count is a guarantee, not an average.
 */

export type SeatStatus = "available" | "held" | "sold";

export type Seat = {
  id: string;
  tierId: string;
  row: string;
  number: number;
  status: SeatStatus;
};

export type Tier = {
  id: string;
  name: string;
  priceCents: number;
  /** Border colour of every seat in this tier, and the legend swatch. */
  color: string;
  rows: number;
  seatsPerRow: number;
  /** Standing tiers are admissions, not numbered seats. */
  isStanding?: boolean;
};

export type VenueType = "theater" | "stadium";

/** A tier joined to its live counts. What the legend and the pricing table read. */
export type TierWithStats = Tier & { stats: SeatStats };

export type SeatStats = {
  total: number;
  available: number;
  held: number;
  sold: number;
};

export type Venue = {
  id: string;
  venueType: VenueType;
  tiers: Tier[];
};

/**
 * Tier palette.
 *
 * Gold, bronze and slate all sit inside the Obsidian/Champagne world. Violet is
 * the one deliberate exception and only ever appears as a fourth tier, because
 * telling tiers apart is a FUNCTIONAL job - someone choosing between price bands
 * has to separate them at a glance - and four bands cannot be distinguished
 * using warm metals alone without two of them collapsing into each other.
 *
 * Measured against the #1A1A1A seat fill, which is what a border carrying
 * meaning has to clear 3:1 against:
 *
 *   gold   #FACC15  11.36:1      slate  #A8A29E  6.90:1
 *   bronze #D97706   5.46:1      violet #A78BFA  6.40:1
 *
 * The first choice for the bronze band was a deeper #B45309. It measures
 * 3.47:1, so it passes - but only just, and a border two hundredths above a
 * threshold is one theme tweak away from being below it. #D97706 clears the
 * same bar with room to spare and separates from gold more cleanly at 28px.
 */
export const TIER_COLORS = {
  gold: "#FACC15",
  bronze: "#D97706",
  slate: "#A8A29E",
  violet: "#A78BFA",
} as const;

/** No I or O: at seat size they read as 1 and 0. */
const ROW_LABELS = "ABCDEFGHJKLMNPQRSTUV".split("");

/** mulberry32 - small, fast, and identical on every platform. */
function makePrng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/* ── venue templates ────────────────────────────────────────────────────── */

/**
 * Seats per row grows front to back, so the rendered block is a wedge without
 * needing a clip-path: the geometry produces the trapezium on its own.
 * 4x14 + 5x16 + 5x18 = 226 seats.
 */
const THEATER_TIERS: Tier[] = [
  { id: "front", name: "Front", priceCents: 499900, color: TIER_COLORS.gold, rows: 4, seatsPerRow: 14 },
  { id: "middle", name: "Middle", priceCents: 249900, color: TIER_COLORS.bronze, rows: 5, seatsPerRow: 16 },
  { id: "rear", name: "Rear", priceCents: 99900, color: TIER_COLORS.slate, rows: 5, seatsPerRow: 18 },
];

/** 3x16 + 4x20 + 5x22 + 2x24 standing = 286. */
const ARENA_TIERS: Tier[] = [
  { id: "pit", name: "Front Pit", priceCents: 599900, color: TIER_COLORS.gold, rows: 3, seatsPerRow: 16 },
  { id: "lower", name: "Lower Bowl", priceCents: 349900, color: TIER_COLORS.bronze, rows: 4, seatsPerRow: 20 },
  { id: "upper", name: "Upper Bowl", priceCents: 149900, color: TIER_COLORS.slate, rows: 5, seatsPerRow: 22 },
  { id: "ga", name: "General Standing", priceCents: 79900, color: TIER_COLORS.violet, rows: 2, seatsPerRow: 24, isStanding: true },
];

type VenueSpec = {
  venueType: VenueType;
  tiers: Tier[];
  /** Exact seats left across the whole venue. Guaranteed, not aimed at. */
  availableTarget: number;
  /**
   * Seats in someone's checkout window right now. An ABSOLUTE count, not a
   * share of the unavailable ones.
   *
   * A share is the wrong model and produces absurd data: 40% of the unsold
   * seats "on hold" means half the venue is mid-checkout simultaneously. A hold
   * lives for minutes, so even during a heavy drop the number is tens, not
   * hundreds - and the map should show a scattering of amber, not a wall of it.
   * Everything unavailable and not held is sold.
   */
  held: number;
  /** Multiplies every tier price, so each show has its own economics. */
  priceScale: number;
};

/**
 * Which venue each mock event uses.
 *
 * `availableTarget` carries the numbers the landing cards used to hard-code.
 * They were chosen so that every card keeps the badge it had before this file
 * existed - four "Only N left", three "Selling fast", the rest quiet - against
 * the new, physically real totals.
 */
const VENUES: Record<string, VenueSpec> = {
  "sf-1": { venueType: "stadium", tiers: ARENA_TIERS, availableTarget: 12, held: 9, priceScale: 1.6 },
  "sf-2": { venueType: "stadium", tiers: ARENA_TIERS, availableTarget: 17, held: 14, priceScale: 2.0 },
  "sf-3": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 7, held: 6, priceScale: 1.0 },
  "sf-4": { venueType: "stadium", tiers: ARENA_TIERS, availableTarget: 16, held: 11, priceScale: 1.0 },
  "rc-1": { venueType: "stadium", tiers: ARENA_TIERS, availableTarget: 48, held: 18, priceScale: 1.3 },
  "rc-2": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 22, held: 7, priceScale: 0.45 },
  "rc-3": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 38, held: 12, priceScale: 1.5 },
  "rc-4": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 4, held: 3, priceScale: 6.0 },
  "cm-1": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 31, held: 8, priceScale: 0.9 },
  "cm-2": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 16, held: 5, priceScale: 0.5 },
  "cm-3": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 54, held: 10, priceScale: 0.3 },
  "mv-1": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 61, held: 9, priceScale: 0.38 },
  "mv-2": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 9, held: 4, priceScale: 0.42 },
  "mv-3": { venueType: "theater", tiers: THEATER_TIERS, availableTarget: 74, held: 13, priceScale: 0.35 },
};

/* ── generation ─────────────────────────────────────────────────────────── */

const seatCache = new Map<string, Seat[]>();
const tierCache = new Map<string, Tier[]>();

/** Tier prices scaled for this event, rounded to a whole ten rupees. */
function buildTiers(spec: VenueSpec): Tier[] {
  return spec.tiers.map((tier) => ({
    ...tier,
    priceCents: Math.round((tier.priceCents * spec.priceScale) / 1000) * 1000,
  }));
}

function buildSeats(eventId: string, spec: VenueSpec, tiers: Tier[]): Seat[] {
  const seats: Seat[] = [];

  for (const tier of tiers) {
    for (let r = 0; r < tier.rows; r++) {
      for (let n = 1; n <= tier.seatsPerRow; n++) {
        seats.push({
          id: `${eventId}-${tier.id}-${ROW_LABELS[r]}${n}`,
          tierId: tier.id,
          row: ROW_LABELS[r],
          number: n,
          status: "available",
        });
      }
    }
  }

  /**
   * Fisher-Yates over an index list, driven by the seeded PRNG. Shuffling
   * indices rather than the seats themselves keeps the array in reading order,
   * so the map still renders row A before row B while the statuses land
   * scattered across the house.
   */
  const prng = makePrng(hashString(eventId));
  const order = seats.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const unavailable = Math.max(0, seats.length - spec.availableTarget);
  const heldCount = Math.min(spec.held, unavailable);

  for (let i = 0; i < unavailable; i++) {
    seats[order[i]].status = i < heldCount ? "held" : "sold";
  }

  return seats;
}

/** Every seat for an event. Empty for an event with no venue defined. */
export function getSeats(eventId: string): Seat[] {
  const cached = seatCache.get(eventId);
  if (cached) return cached;

  const spec = VENUES[eventId];
  if (!spec) return [];

  const seats = buildSeats(eventId, spec, getTiers(eventId));
  seatCache.set(eventId, seats);
  return seats;
}

export function getTiers(eventId: string): Tier[] {
  const cached = tierCache.get(eventId);
  if (cached) return cached;

  const spec = VENUES[eventId];
  if (!spec) return [];

  const tiers = buildTiers(spec);
  tierCache.set(eventId, tiers);
  return tiers;
}

export function getVenue(eventId: string): Venue | null {
  const spec = VENUES[eventId];
  if (!spec) return null;
  return { id: eventId, venueType: spec.venueType, tiers: getTiers(eventId) };
}

export function hasVenue(eventId: string): boolean {
  return eventId in VENUES;
}

/* ── derived numbers — the only way anything downstream gets a count ────── */

/** Counts for a whole event, or for one tier when `tierId` is given. */
export function seatStats(eventId: string, tierId?: string): SeatStats {
  const all = getSeats(eventId);
  const seats = tierId ? all.filter((s) => s.tierId === tierId) : all;

  return {
    total: seats.length,
    available: seats.filter((s) => s.status === "available").length,
    held: seats.filter((s) => s.status === "held").length,
    sold: seats.filter((s) => s.status === "sold").length,
  };
}

/** Tiers joined to their live counts, in front-to-back order. */
export function tierBreakdown(eventId: string): TierWithStats[] {
  return getTiers(eventId).map((tier) => ({
    ...tier,
    stats: seatStats(eventId, tier.id),
  }));
}

/** Cheapest tier price. Null when the event has no venue, never Infinity. */
export function fromPrice(eventId: string): number | null {
  const tiers = getTiers(eventId);
  if (tiers.length === 0) return null;
  return Math.min(...tiers.map((t) => t.priceCents));
}
