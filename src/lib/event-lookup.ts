import "server-only";

import { getEventById, type EventDetail } from "@/db/queries/events";
import {
  RECOMMENDED,
  SELLING_FAST,
  SPOTLIGHT_COMEDY,
  SPOTLIGHT_MOVIES,
  UPCOMING,
  type MockEvent,
  type UpcomingEvent,
} from "@/lib/mock-events";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALL_MOCK: MockEvent[] = [
  ...SELLING_FAST,
  ...RECOMMENDED,
  ...SPOTLIGHT_COMEDY,
  ...SPOTLIGHT_MOVIES,
];

const DAY_MS = 86_400_000;

/**
 * Price ladder for a mock event.
 *
 * `fromPriceCents` is the cheapest tier, so the other two are multiples of it.
 * The ratios are taken from the real seeded data (Rs 4,999 / 2,499 / 999 is
 * roughly 5x / 2.5x / 1x) so a mock detail page and a database one show the same
 * shape of pricing rather than obviously different economics.
 */
const TIERS: { name: string; multiplier: number }[] = [
  { name: "Front", multiplier: 5 },
  { name: "Middle", multiplier: 2.5 },
  { name: "Rear", multiplier: 1 },
];

/**
 * Adapt a homepage mock card into the same shape the database returns.
 *
 * The detail page then has exactly one type to render and never branches on
 * where the record came from - which is what makes replacing the mock rails with
 * real queries a change of source rather than a rewrite.
 */
function fromMock(event: MockEvent): EventDetail {
  const perTier = Math.floor(event.seatsTotal / TIERS.length);
  const availableRatio = event.seatsLeft / event.seatsTotal;

  return {
    id: event.id,
    title: event.title,
    subtitle: event.subtitle,
    description: null,
    venue: event.venue,
    city: event.city,
    startsAt: new Date(event.startsAt),
    /**
     * Mock cards carry no release time, so it is derived: three weeks before
     * the doors open. That is realistic, and it also means the set naturally
     * splits - shows starting soon have already dropped and render the LIVE
     * button, later ones are still counting down. Both CTA branches are
     * reachable from the homepage without editing a timestamp by hand.
     */
    dropAt: new Date(new Date(event.startsAt).getTime() - 21 * DAY_MS),
    status: "live",
    hues: event.hues,
    sections: TIERS.map((tier, index) => ({
      id: `${event.id}-${tier.name.toLowerCase()}`,
      name: tier.name,
      priceCents: Math.round(event.fromPriceCents * tier.multiplier),
      seatsTotal: perTier,
      // Spread the card's real remaining count across the tiers rather than
      // inventing a number, so the detail page agrees with the card.
      seatsLeft: Math.max(
        0,
        Math.min(perTier, Math.round(perTier * availableRatio) - index),
      ),
    })),
    source: "mock",
  };
}

/**
 * Adapt a "Just announced" row.
 *
 * These carry far less than a card does: no venue, no start time, no pricing.
 * That is the point of the section - the show has been announced, the details
 * have not.
 *
 * Nothing is invented to fill the gaps. `sections` comes back empty and the
 * detail page renders an explicit "pricing announced when tickets drop" state
 * rather than three plausible-looking numbers nobody has committed to. Inventing
 * a price on a ticketing product is the kind of small lie that costs the trust
 * the whole thing runs on.
 */
function fromUpcoming(event: UpcomingEvent): EventDetail {
  const dropAt = new Date(event.dropAt);
  return {
    id: event.id,
    title: event.title,
    subtitle: event.subtitle,
    description: null,
    venue: "Venue to be announced",
    city: event.city,
    /* The show itself is not scheduled yet either. Six weeks past the drop is a
       placeholder, and the page never presents it as confirmed. */
    startsAt: new Date(dropAt.getTime() + 42 * DAY_MS),
    dropAt,
    status: "scheduled",
    hues: event.hues,
    sections: [],
    source: "mock",
  };
}

/**
 * Resolve an event id from either source.
 *
 * The homepage rails still render mock records with ids like `sf-1`, while the
 * seeded database holds real events keyed by uuid. Rather than force one of them
 * to change, the id itself says where to look: uuid-shaped goes to Postgres,
 * anything else is looked up in the mock table.
 *
 * Returns null for an id that matches neither, so the page can call notFound().
 */
export async function findEvent(id: string): Promise<EventDetail | null> {
  if (UUID.test(id)) return getEventById(id);

  const mock = ALL_MOCK.find((event) => event.id === id);
  if (mock) return fromMock(mock);

  // The "Just announced" rows live in their own list with a different shape.
  const upcoming = UPCOMING.find((event) => event.id === id);
  return upcoming ? fromUpcoming(upcoming) : null;
}
