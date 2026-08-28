import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";

import { SeatMap } from "@/components/seats/seat-map";
import { findEvent } from "@/lib/event-lookup";
import { getSeats, getVenue, seatStats, tierBreakdown } from "@/lib/mock-data";

type Props = { params: Promise<{ id: string }> };

function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await findEvent(id);
  if (!event) return { title: "Event not found" };
  return {
    title: `Choose seats · ${event.title}`,
    description: `Pick your seats for ${event.title} at ${event.venue}, ${event.city}.`,
  };
}

/**
 * Seat selection.
 *
 * A server component that resolves the event and hands the grid to the client.
 * The seats are read here, on the server, from the same `mock-data.ts` the
 * landing card and the pricing table read - so the number the user saw on the
 * card is the number of gold-bordered squares they can actually click.
 */
export default async function SeatsPage({ params }: Props) {
  const { id } = await params;
  const event = await findEvent(id);

  if (!event) notFound();

  const venue = getVenue(id);
  const stats = seatStats(id);

  return (
    /* Bottom padding clears the fixed checkout bar. Without it the status key
       sits permanently underneath the cart and cannot be scrolled into view. */
    <main className="mx-auto max-w-6xl px-4 pb-44 pt-8 sm:px-6 sm:pt-12">
      <Link
        href={`/events/${id}`}
        className="inline-flex items-center gap-2 rounded-full py-2 text-sm text-foreground/75 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to {event.title}
      </Link>

      <header className="mt-4">
        <h1 className="text-metal text-balance text-3xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
          Choose your seats
        </h1>
        <p className="mt-3 text-lg text-gold-champagne/90">{event.title}</p>

        <div className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-6">
          <p className="flex items-center gap-2">
            <CalendarDays className="size-4 shrink-0 text-gold" aria-hidden="true" />
            {formatWhen(event.startsAt)}
          </p>
          <p className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0 text-gold" aria-hidden="true" />
            {event.venue}, {event.city}
          </p>
        </div>
      </header>

      {venue ? (
        <>
          <p className="mt-7 text-sm text-muted-foreground">
            <span className="tabular-nums text-foreground">{stats.available}</span> of{" "}
            <span className="tabular-nums">{stats.total}</span> seats available
            {stats.held > 0 && (
              <>
                {" · "}
                <span className="tabular-nums">{stats.held}</span> currently in
                someone&rsquo;s checkout
              </>
            )}
          </p>

          <div className="mt-6">
            <SeatMap
              venueType={venue.venueType}
              tiers={tierBreakdown(id)}
              seats={getSeats(id)}
            />
          </div>
        </>
      ) : (
        /*
          A real database event resolved, but T19's map is still driven by the
          mock venue table - there is no seating chart for it yet.

          This says so instead of rendering an empty black box that looks like a
          bug, and instead of 404ing an event that genuinely exists. When T20
          wires holds to Postgres, this branch is where the real query lands.
        */
        <div className="glass mt-8 rounded-2xl border-gold/20 px-6 py-12 text-center">
          <p className="text-sm text-foreground">
            Seat selection is not open for this event yet
          </p>
          <p className="mx-auto mt-2 max-w-sm text-pretty text-xs leading-relaxed text-muted-foreground">
            This event has no published seating chart. Tiers and pricing are on
            the event page.
          </p>
          <Link
            href={`/events/${id}`}
            className="btn-gold-outline mt-6 inline-flex h-11 items-center rounded-xl px-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View pricing
          </Link>
        </div>
      )}
    </main>
  );
}
