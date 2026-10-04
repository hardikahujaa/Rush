import type { Metadata } from "next";
import Link from "next/link";
import { SearchX, X } from "lucide-react";

import { EventCard } from "@/components/home/event-card";
import { Footer } from "@/components/layout/footer/footer";
import { getEventCards, type EventBucket } from "@/db/queries/events";

export const metadata: Metadata = {
  title: "All events",
  description:
    "Every show on Rush — what is on sale now, what drops next, and what has already played.",
};

/** The filter chips. Each one is a real slice of the data, not a label. */
const FILTERS: { key: EventBucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "on-sale", label: "On sale" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
];

function isBucket(value: string | undefined): value is EventBucket {
  return value === "all" || value === "on-sale" || value === "upcoming" || value === "past";
}

type Props = {
  searchParams: Promise<{ status?: string; q?: string }>;
};

/**
 * `/events` — the full catalogue (T17).
 *
 * ── HOW A SERVER COMPONENT FETCHES DATA, AND WHY IT IS DIFFERENT ───────────
 * This component is `async` and simply awaits the query. There is no
 * `/api/events` route, no `useEffect`, no `isLoading` state: the function runs
 * on the server during render, talks to Postgres over a connection the browser
 * never sees, and ships HTML.
 *
 * In plain React the same page needs a client-side round trip - render empty,
 * fetch on mount, set state, render again - which means three paint states, a
 * public API endpoint to secure and rate limit, and the database credentials
 * living somewhere the browser can reach. Here the data is already in the first
 * byte of HTML, so there is no spinner for the common case and nothing to
 * secure that is not already server-side.
 *
 * The cost is that nothing renders until the query returns, which is what
 * `loading.tsx` beside this file covers: Next streams that skeleton
 * immediately and swaps in this page when the await resolves.
 *
 * ── WHY THE FILTERS ARE STATUS AND NOT CATEGORY ────────────────────────────
 * The navbar used to offer six category links and all six were 404s - `events`
 * has no category column, so category filtering could only ever have been
 * theatre. Status is a slice the data genuinely supports, derived in
 * `getEventCards` from `status` + `drop_at` + `starts_at` together.
 *
 * `?q=` is honoured because the navbar's search box has always pushed to
 * `/events?q=…`; until this page existed that was a 404 too.
 */
export default async function EventsPage({ searchParams }: Props) {
  /* `searchParams` is a Promise in Next.js 16 - synchronous access was removed. */
  const params = await searchParams;
  const bucket: EventBucket = isBucket(params.status) ? params.status : "all";
  const q = params.q?.trim() ?? "";

  const results = await getEventCards({ bucket, q: q || undefined, limit: 48 });

  /** Preserve the search when switching filters, and the filter when clearing. */
  const hrefFor = (key: EventBucket) => {
    const sp = new URLSearchParams();
    if (key !== "all") sp.set("status", key);
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return qs ? `/events?${qs}` : "/events";
  };

  const activeLabel = FILTERS.find((f) => f.key === bucket)?.label ?? "All";

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        <header>
          <h1 className="text-metal text-balance text-3xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-4xl">
            All events
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="tabular-nums text-foreground">{results.length}</span>{" "}
            {results.length === 1 ? "event" : "events"}
            {bucket !== "all" && <> · {activeLabel.toLowerCase()}</>}
            {q && (
              <>
                {" "}
                matching{" "}
                <span className="text-gold-champagne">&ldquo;{q}&rdquo;</span>
              </>
            )}
          </p>
        </header>

        {/* ── filters ──────────────────────────────────────────────────── */}
        <nav
          aria-label="Filter events"
          className="no-scrollbar mt-6 -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1"
        >
          {FILTERS.map((filter) => {
            const active = filter.key === bucket;
            return (
              <Link
                key={filter.key}
                href={hrefFor(filter.key)}
                /* The active chip is the current page, so it is announced
                   rather than just coloured - colour alone would leave a
                   screen reader with four identical links. */
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "shrink-0 snap-start rounded-full border border-gold/45 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-champagne outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    : "glass shrink-0 snap-start rounded-full px-4 py-2 text-sm font-medium text-foreground/80 outline-none transition-colors hover:border-gold/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                }
              >
                {filter.label}
              </Link>
            );
          })}

          {q && (
            <Link
              href={bucket === "all" ? "/events" : `/events?status=${bucket}`}
              className="glass ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5 shrink-0" aria-hidden="true" />
              Clear search
            </Link>
          )}
        </nav>

        {/* ── results ──────────────────────────────────────────────────── */}
        {results.length > 0 ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : (
          /* A designed empty state per filter, rather than a blank grid. Each
             message names the thing that is actually empty, because "no
             results" on a page with four filters and a search box does not
             tell you which of the five to change. */
          <div className="glass mt-10 rounded-2xl px-6 py-16 text-center">
            <SearchX
              className="mx-auto size-7 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="mt-4 text-sm text-foreground">
              {q
                ? `Nothing matches “${q}”`
                : bucket === "on-sale"
                  ? "Nothing is on sale right now"
                  : bucket === "upcoming"
                    ? "No drops are scheduled"
                    : bucket === "past"
                      ? "No events have finished yet"
                      : "No events are published yet"}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-pretty text-xs leading-relaxed text-muted-foreground">
              {q
                ? "Try a show name, a venue, or a city."
                : bucket === "all"
                  ? "When an organizer publishes a show it appears here immediately."
                  : "Try another filter — there may be events in a different stage."}
            </p>
            {(q || bucket !== "all") && (
              <Link
                href="/events"
                className="btn-gold-outline mt-6 inline-flex h-11 items-center rounded-xl px-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Show all events
              </Link>
            )}
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
