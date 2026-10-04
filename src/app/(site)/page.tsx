import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { Footer } from "@/components/layout/footer/footer";
import { EventRail } from "@/components/home/event-rail";
import { Hero } from "@/components/home/hero";
import { getEventCards } from "@/db/queries/events";

/**
 * Homepage — the VIP Lobby.
 *
 * ── EVERY EVENT ON THIS PAGE IS REAL (T17) ─────────────────────────────────
 * Until T17 all five rails rendered `src/lib/mock-events.ts`. A crawl of the
 * rendered page found **18 dead links** and 18 event pages whose seat maps could
 * never be held or bought, because mock seat ids like `rc-3-front-A3` exist
 * nowhere in Postgres and `resolveSeatMap` correctly refuses to let them be
 * held. In a demo every one of those reads as a bug.
 *
 * Now there are two rails and both come from the `events` table, so every card
 * links to a uuid with a working seat map behind it.
 *
 * ── WHY TWO RAILS AND NOT FIVE ─────────────────────────────────────────────
 * The old "Recommended for you" and two "Spotlight" rails were category slices,
 * and `events` has no category column. Keeping them would have meant either
 * inventing categories or showing the same rows four times under four headings.
 * On sale / next drops is the one split the data genuinely supports, and it is
 * the split that matters: what you can buy now, and what to come back for.
 *
 * The category chip rail that used to sit under the hero went with them - all
 * six of its links were 404s.
 *
 * ── WHY THIS IS NOW `async` ────────────────────────────────────────────────
 * A Server Component may await data directly. There is no `/api/events` route,
 * no `useEffect`, no loading state threaded through props: the query runs on the
 * server during render and only HTML reaches the browser. That is the difference
 * from plain React, where this component would have to render empty first, fetch
 * on mount, then re-render - three paint states and a client-side round trip for
 * data the server already had.
 */
export default async function HomePage() {
  /* Fetched concurrently rather than in sequence - they are independent, and
     awaiting them one after the other would add their latencies together. */
  const [onSale, upcoming] = await Promise.all([
    getEventCards({ bucket: "on-sale", limit: 8 }),
    getEventCards({ bucket: "upcoming", limit: 8 }),
  ]);

  const nothingAtAll = onSale.length === 0 && upcoming.length === 0;

  return (
    <>
      <Hero />

      {/* Each rail renders only when it has rows. A headed rail with nothing
          under it looks like a failed fetch, which is precisely the impression
          T17 exists to remove. */}
      {onSale.length > 0 && (
        <EventRail
          id="on-sale"
          eyebrow="On sale now"
          title="Pick your seats tonight"
          description="Live inventory. Seat counts are the output of the availability query — sold seats and seats in someone else's checkout are already excluded, so the number is real."
          events={onSale}
          accentHue={82}
        />
      )}

      {upcoming.length > 0 && (
        <EventRail
          id="next-drops"
          eyebrow="Next drops"
          title="Set your alarm"
          description="Tickets for these have not been released yet. The countdown on each event page is the one that matters."
          events={upcoming}
          accentHue={62}
        />
      )}

      {/*
        The all-empty state. Unreachable with the seeded catalogue, but a
        homepage that renders the hero and then simply stops would read as a
        broken page rather than an empty one.
      */}
      {nothingAtAll && (
        <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
          <div className="glass rounded-2xl px-6 py-14">
            <CalendarClock
              className="mx-auto size-7 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="mt-4 text-sm text-foreground">
              No events are published yet
            </p>
            <p className="mx-auto mt-2 max-w-sm text-pretty text-xs leading-relaxed text-muted-foreground">
              Nothing is on sale and nothing is scheduled to drop. When an
              organizer publishes a show it appears here immediately.
            </p>
            <Link
              href="/events"
              className="btn-gold-outline mt-6 inline-flex h-11 items-center rounded-xl px-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Browse everything
            </Link>
          </div>
        </section>
      )}

      <Footer />
    </>
  );
}
