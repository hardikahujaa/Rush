import { EventRail } from "@/components/home/event-rail";
import { Hero } from "@/components/home/hero";
import { QuickFilters } from "@/components/home/quick-filters";
import { Upcoming } from "@/components/home/upcoming";
import {
  RECOMMENDED,
  SELLING_FAST,
  SPOTLIGHT_COMEDY,
  SPOTLIGHT_MOVIES,
} from "@/lib/mock-events";

/**
 * Homepage.
 *
 * Scroll order is a funnel: what is about to be gone, what suits you, what you
 * might not have considered, what has not opened yet. Urgency first because that
 * is the only section with a deadline attached.
 *
 * All rails currently render MOCK data from src/lib/mock-events.ts.
 * TODO(T17): swap each `events` prop for a query from src/db/queries/events.ts.
 * The components already take data as props, so nothing below changes shape.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <QuickFilters />

      <EventRail
        eyebrow="Selling fast"
        title="Going in minutes, not days"
        description="Seat counts here are live from the availability query — held and sold seats are already excluded, so the number is real."
        events={SELLING_FAST}
        accentHue={75}
      />

      <EventRail
        eyebrow="Recommended for you"
        title="Near you in Chennai"
        description="Based on your selected city. Change it from the navbar to see another."
        events={RECOMMENDED}
        accentHue={292}
      />

      <EventRail
        eyebrow="Spotlight"
        title="Best of comedy"
        href="/events?category=comedy-theater"
        events={SPOTLIGHT_COMEDY}
        accentHue={75}
      />

      <EventRail
        eyebrow="Spotlight"
        title="Top movies this week"
        href="/events?category=movies"
        events={SPOTLIGHT_MOVIES}
        accentHue={262}
      />

      <Upcoming />
    </>
  );
}
