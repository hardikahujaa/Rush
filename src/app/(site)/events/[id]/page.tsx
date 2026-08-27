import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin, Ticket } from "lucide-react";

import { EventCTA } from "@/components/events/event-cta";
import { findEvent } from "@/lib/event-lookup";
import { formatPaise } from "@/lib/mock-events";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

/** "Saturday, 4 September 2026 · 7:30 PM" */
function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

/**
 * `params` is a Promise in Next.js 16 - it must be awaited here as well as in
 * the page, and generateMetadata runs in parallel with it, so the lookup is
 * cached by React between the two calls rather than querying twice.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await findEvent(id);
  if (!event) return { title: "Event not found" };

  return {
    title: event.title,
    description:
      event.description ??
      `${event.title} at ${event.venue}, ${event.city}. Tickets on RUSH.`,
  };
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;
  const event = await findEvent(id);

  // PLAN.md T18 requires this explicitly: an unknown id renders the 404 route
  // rather than a page full of empty fields.
  if (!event) notFound();

  const [h1, h2] = event.hues;
  const seatsLeft = event.sections.reduce((sum, s) => sum + s.seatsLeft, 0);
  const seatsTotal = event.sections.reduce((sum, s) => sum + s.seatsTotal, 0);
  const soldOut = seatsTotal > 0 && seatsLeft === 0;
  /* Math.min of an empty array is Infinity, which would render as a nonsense
     price on a just-announced event. Null means "not announced yet". */
  const cheapest = event.sections.length
    ? Math.min(...event.sections.map((s) => s.priceCents))
    : null;

  return (
    <main className="relative">
      {/* ── CINEMATIC HERO ──────────────────────────────────────────────
          The poster is generated from the event's own two hues rather than
          loaded: no network request, no layout shift, and it cannot leave the
          palette because both hues sit in the 45-95 gold band. The same
          technique the cards use, so arriving here from a card feels continuous
          rather than like a different product. */}
      <section className="relative isolate">
        <div className="relative h-[62svh] min-h-[420px] w-full overflow-hidden sm:h-[70svh]">
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(80% 70% at 22% 18%, oklch(0.74 0.16 ${h1} / 0.9), transparent 62%),
                radial-gradient(75% 70% at 82% 82%, oklch(0.58 0.13 ${h2} / 0.8), transparent 60%),
                linear-gradient(160deg, oklch(0.20 0.04 ${h1}), oklch(0.05 0.01 ${h2}))
              `,
            }}
          />

          {/* Fine vertical fluting, echoing the lobby columns in the hero. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, transparent 0 11px, oklch(1 0 0 / 0.35) 11px 12px)",
              maskImage:
                "radial-gradient(80% 70% at 50% 40%, black, transparent 78%)",
              WebkitMaskImage:
                "radial-gradient(80% 70% at 50% 40%, black, transparent 78%)",
            }}
          />

          {/* The fade into the page. Two stops rather than one: the lower half
              reaches full black so the section boundary is invisible, while the
              upper band only dims enough to keep the back link legible. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black via-black/90 to-transparent"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent"
          />

          <div className="absolute inset-x-0 top-0 z-10 mx-auto max-w-5xl px-4 pt-6 sm:px-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to events
            </Link>
          </div>
        </div>

        {/* Title block, pulled up over the fade so it sits in the artwork. */}
        <div className="relative z-10 mx-auto -mt-40 max-w-5xl px-4 sm:-mt-48 sm:px-6">
          <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-gold-champagne">
            <Ticket className="size-3.5" aria-hidden="true" />
            {event.status === "ended" ? "Past event" : "On RUSH"}
          </span>

          <h1 className="text-metal mt-5 text-balance text-4xl font-bold leading-[1.02] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            {event.title}
          </h1>

          {event.subtitle && (
            <p className="mt-3 text-lg text-gold-champagne/90 sm:text-xl">
              {event.subtitle}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-6">
            <p className="flex items-center gap-2">
              <CalendarDays className="size-4 shrink-0 text-gold" aria-hidden="true" />
              {formatWhen(event.startsAt)}
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0 text-gold" aria-hidden="true" />
              {event.venue}, {event.city}
            </p>
          </div>

          {event.description && (
            <p className="mt-7 max-w-2xl text-pretty text-[15px] leading-relaxed text-muted-foreground">
              {event.description}
            </p>
          )}
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto mt-14 max-w-5xl px-4 sm:px-6">
        <div className="glass rounded-3xl border-gold/15 px-6 py-10 sm:px-10 sm:py-12">
          <EventCTA
            dropAtIso={event.dropAt.toISOString()}
            dropLabel={formatWhen(event.dropAt)}
            eventId={event.id}
            soldOut={soldOut}
          />
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────────── */}
      <section className="mx-auto mt-14 max-w-5xl px-4 pb-24 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold-champagne">
              Pricing
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              Choose your tier
            </h2>
          </div>
          {cheapest !== null && (
            <p className="hidden shrink-0 text-sm text-muted-foreground sm:block">
              from{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatPaise(cheapest)}
              </span>
            </p>
          )}
        </div>

        {/*
          Just-announced events genuinely have no pricing yet, so this says so
          rather than inventing three plausible tiers. A ticketing product that
          shows a price nobody has committed to has already spent the trust it
          needs at checkout.
        */}
        {event.sections.length === 0 && (
          <div className="glass mt-7 rounded-2xl border-gold/20 px-6 py-10 text-center">
            <p className="text-sm text-foreground">
              Pricing is announced when tickets drop
            </p>
            <p className="mx-auto mt-2 max-w-sm text-pretty text-xs leading-relaxed text-muted-foreground">
              The organizer has not published tiers for this show yet. Set a
              reminder above and the prices land with the release.
            </p>
          </div>
        )}

        <ul className="mt-7 overflow-hidden rounded-2xl">
          {event.sections.map((section, index) => {
            const gone = section.seatsLeft === 0;
            const scarce = !gone && section.seatsLeft <= section.seatsTotal * 0.1;

            return (
              <li
                key={section.id}
                className={cn(
                  "glass flex items-center justify-between gap-4 border-gold/20 px-5 py-5 sm:px-6",
                  gone && "opacity-55",
                )}
                /* One seam between rows rather than a border on each, which
                   would double up and read as a heavier line. */
                style={{ marginTop: index === 0 ? 0 : -1 }}
              >
                <div className="min-w-0">
                  <p className="text-base font-medium tracking-[-0.01em] sm:text-lg">
                    {section.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {gone
                      ? "Sold out"
                      : `${section.seatsLeft} of ${section.seatsTotal} seats available`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  {/* A dot as well as colour, so scarcity is not carried by hue
                      alone for anyone who cannot separate these two. */}
                  {scarce && (
                    <span className="hidden items-center gap-1.5 rounded-full border border-gold/35 bg-gold/12 px-2.5 py-1 text-[11px] font-medium text-gold-champagne sm:flex">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
                      Almost gone
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-lg font-semibold tabular-nums sm:text-xl",
                      gone ? "text-muted-foreground line-through" : "text-gold-champagne",
                    )}
                  >
                    {formatPaise(section.priceCents)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {event.sections.length > 0 && (
        <p className="mt-5 text-xs text-muted-foreground">
          {event.source === "database"
            ? "Seat counts are live: sold seats and unexpired holds are already excluded."
            : "This listing renders placeholder data while the events table is wired up."}
        </p>
        )}
      </section>
    </main>
  );
}
