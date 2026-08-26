import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { EventCard } from "@/components/home/event-card";
import type { MockEvent } from "@/lib/mock-events";
import { cn } from "@/lib/utils";

/**
 * A titled row of event cards.
 *
 * One component for every rail on the page (Selling Fast, Recommended, the
 * category spotlights) because they differ only in copy and data. Building three
 * near-identical sections would guarantee they drift apart the first time
 * anything changes.
 *
 * On mobile it scrolls horizontally with snap points; from `md` up it becomes a
 * grid, because a horizontal rail on a wide screen wastes the width and hides
 * items behind an interaction people miss.
 */
export function EventRail({
  eyebrow,
  title,
  description,
  href = "/events",
  events,
  accentHue,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  href?: string;
  events: MockEvent[];
  /** Tints the eyebrow so consecutive rails are distinguishable at a glance. */
  accentHue?: number;
}) {
  return (
    <section className="relative py-10 sm:py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {eyebrow && (
              <p
                className="text-[11px] font-medium uppercase tracking-[0.18em]"
                style={{
                  color: accentHue
                    ? `oklch(0.8 0.16 ${accentHue})`
                    : "var(--primary)",
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
            className="group/all hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:flex"
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
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              className="w-[78vw] shrink-0 snap-start sm:w-[20rem] md:w-auto"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
