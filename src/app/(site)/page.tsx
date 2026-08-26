import { Footer } from "@/components/layout/footer/footer";
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
 * Homepage — the VIP Lobby.
 *
 * Scroll order is a funnel: what is about to be gone, what suits you, what you
 * might not have considered, what has not opened yet. Urgency leads because it
 * is the only section with a deadline attached.
 *
 * All rails render MOCK data from src/lib/mock-events.ts. Every component takes
 * its data as props, so wiring real queries later changes the source, not the
 * shape.
 */
export default function HomePage() {
  return (
    <>
      <Hero />

      <QuickFilters />

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
