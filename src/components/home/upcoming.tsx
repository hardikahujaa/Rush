import Link from "next/link";
import { Bell } from "lucide-react";

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
 * TODO(Phase 2+): wire "Set reminder" to a server action writing a reminders
 * row, and show a live countdown once inside 24 hours.
 */
export function Upcoming() {
  return (
    <section id="just-announced" className="relative py-10 sm:py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold-champagne">
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
              className="glass group/row relative flex flex-col gap-3 p-4 transition-colors hover:border-gold/25 sm:flex-row sm:items-center sm:gap-5 sm:p-5"
              /* A single seam between rows rather than a border on each, which
                 would double up and read as a heavier line. */
              style={{ marginTop: i === 0 ? 0 : -1 }}
            >
              <span
                aria-hidden="true"
                className="hidden size-12 shrink-0 rounded-xl sm:block"
                style={{
                  background: `linear-gradient(140deg, oklch(0.78 0.14 ${e.hues[0]}), oklch(0.45 0.09 ${e.hues[1]}))`,
                }}
              />

              <div className="min-w-0 flex-1">
                {/*
                  STRETCHED LINK, not a wrapper.

                  The obvious way to make the whole row clickable is to wrap it
                  in <Link>. That is invalid here: this row also contains a
                  <button>, and HTML forbids interactive content inside an <a>.
                  Browsers recover from it unpredictably and keyboard users get a
                  control they cannot reach.

                  Instead the link stays a normal anchor around the title - so
                  its accessible name is the event name, and the tab stop is
                  where a reader expects - and its ::after is stretched over the
                  whole row to catch pointer clicks. The reminder button sits on
                  a higher layer, so it still receives its own clicks.
                */}
                <Link
                  href={`/events/${e.id}`}
                  className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block truncate text-base font-medium tracking-[-0.01em] transition-colors group-hover/row:text-gold-champagne">
                    {e.title}
                  </span>
                </Link>
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

                {/* z-10 lifts the button above the stretched link's ::after,
                    which would otherwise swallow every click on it. */}
                <button
                  type="button"
                  className="btn-gold-outline relative z-10 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Bell className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Set reminder</span>
                  <span className="sr-only sm:hidden">Set reminder for {e.title}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
