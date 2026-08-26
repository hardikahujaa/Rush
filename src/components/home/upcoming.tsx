import { BellPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UPCOMING } from "@/lib/mock-events";

/** "Mon, 1 Sep · 11:00 AM" */
function formatDrop(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

/**
 * Events whose tickets have not been released yet.
 *
 * Rows, not cards: there is no price and no availability to show, so a card grid
 * would be mostly empty space pretending to be full. What matters here is one
 * date and one action, which a list carries better.
 *
 * TODO(T18): wire "Set reminder" to a server action writing a reminders row, and
 * show a live countdown once inside 24 hours.
 */
export function Upcoming() {
  return (
    <section className="relative py-10 sm:py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand-2">
          Just announced
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
          Not on sale yet
        </h2>
        <p className="mt-2 max-w-lg text-pretty text-sm text-muted-foreground">
          Set a reminder and we will tell you the moment the queue opens — not
          after it has closed.
        </p>

        <ul className="mt-7 overflow-hidden rounded-2xl">
          {UPCOMING.map((e, i) => (
            <li
              key={e.id}
              className="glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5"
              style={{
                // A single seam between rows rather than a border on each,
                // which would double up and read as a heavier line.
                marginTop: i === 0 ? 0 : -1,
              }}
            >
              {/* Hue swatch standing in for artwork. Small on purpose - this row
                  is about the date, not the picture. */}
              <span
                aria-hidden="true"
                className="hidden size-12 shrink-0 rounded-xl sm:block"
                style={{
                  background: `linear-gradient(140deg, oklch(0.62 0.22 ${e.hues[0]}), oklch(0.55 0.18 ${e.hues[1]}))`,
                }}
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium tracking-[-0.01em]">
                  {e.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {e.subtitle} · {e.category} · {e.city}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div className="text-left sm:text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Tickets open
                  </p>
                  <p className="text-sm tabular-nums text-foreground">
                    {formatDrop(e.dropAt)}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 rounded-full border-border/70 bg-transparent"
                >
                  <BellPlus className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Set reminder</span>
                  <span className="sr-only sm:hidden">
                    Set reminder for {e.title}
                  </span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
