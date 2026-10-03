import { Footer } from "@/components/layout/footer/footer";
import { EventRail } from "@/components/home/event-rail";
import { Hero } from "@/components/home/hero";
import { QuickFilters } from "@/components/home/quick-filters";
import { Upcoming } from "@/components/home/upcoming";
import { getLiveEvents } from "@/db/queries/events";
import {
  RECOMMENDED,
  SELLING_FAST,
  SPOTLIGHT_COMEDY,
  SPOTLIGHT_MOVIES,
} from "@/lib/mock-events";

/**
 * Homepage — the VIP Lobby.
 *
 * Scroll order is a funnel: what is about to be gone, what suits you, what you
 * might not have considered, what has not opened yet. Urgency leads because it
 * is the only section with a deadline attached.
 *
 * ── "LIVE NOW" IS REAL; THE RAILS BELOW IT ARE NOT ────────────────────────
 * The first rail reads genuine rows from Postgres via `getLiveEvents()`. Every
 * rail beneath it still renders MOCK data from src/lib/mock-events.ts, whose
 * seat ids exist nowhere in the database - so those listings deliberately
 * cannot be held or bought, and the seat map says so.
 *
 * That distinction was previously invisible, and it was the whole bug: with 18
 * mock events linked from here and 0 real ones, there was no route through the
 * UI to an event anyone could actually buy. "Live now" is the route.
 *
 * Every component still takes its data as props, so finishing T17 means
 * swapping the sources, not the shapes.
 */
export default async function HomePage() {
  const liveEvents = await getLiveEvents();

  return (
    <>
      <Hero />

      <QuickFilters />

      {/* Rendered only when there is something genuinely on sale - an empty
          "Live now" rail would be worse than none, and it is the honest state
          when no event has dropped yet. */}
      {liveEvents.length > 0 && (
        <EventRail
          id="live-now"
          eyebrow="Live now"
          title="On sale this minute"
          description="Real events, real inventory. These are the ones you can hold and pay for — seat counts come straight from the availability query."
          events={liveEvents}
          accentHue={82}
        />
      )}

      <EventRail
        id="selling-fast"
        eyebrow="Selling fast"
        title="Going in minutes, not days"
        description="Seat counts are the live output of the availability query — held and sold seats are already excluded, so the number is real."
        events={SELLING_FAST}
        accentHue={75}
      />

      <EventRail
        id="recommended"
        eyebrow="Recommended for you"
        title="Near you in Chennai"
        description="Based on your selected city. Change it from the navbar to see another."
        events={RECOMMENDED}
        accentHue={88}
      />

      <EventRail
        id="spotlight-comedy"
        eyebrow="Spotlight"
        title="Best of comedy"
        href="/events?category=comedy-theater"
        events={SPOTLIGHT_COMEDY}
        accentHue={62}
      />

      <EventRail
        id="spotlight-movies"
        eyebrow="Spotlight"
        title="Top movies this week"
        href="/events?category=movies"
        events={SPOTLIGHT_MOVIES}
        accentHue={55}
      />

      <Upcoming />

      <Footer />
    </>
  );
}
