import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { EventCard, type EventCardData } from "@/components/home/event-card";
import { Reveal } from "@/components/home/reveal";
import { cn } from "@/lib/utils";

/**
 * A titled row of event cards.
 *
 * One component for every rail on the page because they differ only in copy and
 * data. Building five near-identical sections would guarantee they drift apart
 * the first time anything changes.
 *
 * Horizontal scroll with snap points on mobile; a grid from `md` up, because a
 * horizontal rail on a wide screen wastes the width and hides items behind an
 * interaction people miss.
 */
export function EventRail({
  eyebrow,
  title,
  description,
  href = "/events",
  events,
  accentHue,
  id,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  href?: string;
  events: EventCardData[];
  accentHue?: number;
  id?: string;
}) {
  return (
    <section id={id} className="relative py-10 sm:py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {eyebrow && (
              <p
                className="text-[11px] font-medium uppercase tracking-[0.18em]"
                style={{
                  color: accentHue
                    ? `oklch(0.86 0.12 ${accentHue})`
                    : "var(--gold-champagne)",
                }}
              >
                {eyebrow}
              </p>
            )}
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              {title}
            </h2>
            {description && (
              <p className="mt-2 max-w-lg text-pretty text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          <Link
            href={href}
            className="group/all hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:text-gold-champagne focus-visible:ring-2 focus-visible:ring-ring sm:flex"
          >
            View all
            <ArrowRight
              className="size-3.5 transition-transform duration-200 group-hover/all:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>

        <div
          className={cn(
            "no-scrollbar mt-7 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2",
            "md:grid md:snap-none md:grid-cols-2 md:overflow-visible lg:grid-cols-4",
          )}
        >
          {events.map((event, index) => (
            <Reveal key={event.id} delay={Math.min(index, 4) * 0.06}>
              <EventCard
                event={event}
                className="w-[78vw] shrink-0 snap-start sm:w-[20rem] md:w-auto"
              />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
