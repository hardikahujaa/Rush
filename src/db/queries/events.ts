import "server-only";

import { and, asc, desc, eq, gt, lte, ne } from "drizzle-orm";

import { db } from "@/db";
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
