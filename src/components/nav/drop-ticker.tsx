"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/**
 * The current time, as an external store.
 *
 * The obvious implementation is `useState` plus a `setInterval` in a `useEffect`,
 * but the clock is not React state - it is a mutable value owned by the outside
 * world, which is precisely what `useSyncExternalStore` exists for. Using it
 * here also solves the server/client problem cleanly: the server snapshot is a
 * fixed 0, so SSR renders a placeholder and the clock only starts once hydrated.
 * No hydration mismatch, and no setState during an effect.
 *
 * `getSnapshot` MUST return a stable value within a single render, or React will
 * re-render forever chasing a number that changed while it looked at it. Hence
 * the cache: it only produces a new value when the whole second has ticked over.
 */
let cachedSecond = -1;

function getClientSnapshot() {
  const second = Math.floor(Date.now() / 1000);
  if (second !== cachedSecond) cachedSecond = second;
  return cachedSecond;
}

function getServerSnapshot() {
  return 0;
}

function subscribe(onChange: () => void) {
  // Polled faster than once a second so the displayed value never lags a tick
  // behind the wall clock. React skips the re-render when the snapshot matches.
  const id = setInterval(onChange, 250);
  return () => clearInterval(id);
}

function useNowSeconds() {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

type Props = {
  eventId: string;
  title: string;
  venue: string;
  /** ISO string, not a Date - only serialisable values cross the server
   *  component boundary. */
  dropAtIso: string;
  isLive: boolean;
};

type Remaining = { d: number; h: number; m: number; s: number; total: number };

function remaining(target: number, now: number): Remaining {
  const total = Math.max(0, target - now);
  const s = Math.floor(total / 1000);
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
    total,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The next drop, counting down, in the navbar.
 *
 * This is the one piece of chrome that is genuinely about what RUSH is. A
 * ticketing site lives or dies on a moment, and putting that moment in front of
 * people on every page is information, not decoration - it is the thing they
 * came to find out.
 *
 * The urgency states are load-bearing rather than cosmetic: inside ten minutes
 * the whole pill changes colour and the dot beats faster, because that is when
 * someone needs to stop reading and get to the seat map.
 */
export function DropTicker({ eventId, title, venue, dropAtIso, isLive }: Props) {
  const target = new Date(dropAtIso).getTime();

  /**
   * `null` on the server and until hydration, because `getServerSnapshot`
   * returns 0. That is what keeps the markup identical on both sides - a
   * countdown rendered during SSR would already be wrong by the time it reached
   * the browser, and React would flag the mismatch.
   */
  const nowSeconds = useNowSeconds();
  const time: Remaining | null =
    nowSeconds === 0 ? null : remaining(target, nowSeconds * 1000);

  const dropped = isLive || (time !== null && time.total === 0);
  const urgent = !dropped && time !== null && time.total < 10 * 60 * 1000;
  const soon = !dropped && !urgent && time !== null && time.total < 60 * 60 * 1000;

  return (
    <Link
      href={`/events/${eventId}`}
      className={cn(
        "group hidden items-center gap-2.5 rounded-full border py-1.5 pl-2.5 pr-3.5 transition-colors lg:inline-flex",
        "border-border/70 bg-card/60 hover:border-border hover:bg-card",
        urgent && "border-seat-held/40 bg-seat-held/10 hover:border-seat-held/60",
      )}
      aria-label={
        dropped ? `${title} is on sale now` : `${title} drops soon`
      }
    >
      <span className="relative flex size-2 shrink-0" aria-hidden="true">
        <span
          className={cn(
            "absolute inline-flex size-full rounded-full opacity-70",
            dropped
              ? "animate-ping bg-live"
              : urgent
                ? "animate-ping bg-seat-held"
                : "bg-transparent",
          )}
          style={urgent ? { animationDuration: "1s" } : undefined}
        />
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            dropped ? "bg-live" : urgent ? "bg-seat-held" : "bg-primary",
          )}
        />
      </span>

      <span className="flex items-baseline gap-2 text-xs">
        <span
          className={cn(
            "font-medium uppercase tracking-wider",
            dropped
              ? "text-live"
              : urgent
                ? "text-seat-held"
                : "text-muted-foreground",
          )}
        >
          {dropped ? "On sale" : "Next drop"}
        </span>

        <span className="max-w-[15ch] truncate text-foreground/90">{title}</span>

        {!dropped && (
          <span
            className={cn(
              "font-mono tabular-nums",
              urgent
                ? "text-seat-held"
                : soon
                  ? "text-foreground"
                  : "text-muted-foreground",
            )}
            /* The clock changes every second; without this a screen reader
               would interrupt itself endlessly reading it out. */
            aria-hidden="true"
          >
            {time === null
              ? " "
              : time.d > 0
                ? `${time.d}d ${pad(time.h)}h`
                : `${pad(time.h)}:${pad(time.m)}:${pad(time.s)}`}
          </span>
        )}
      </span>

      <span className="sr-only">
        {venue}. {dropped ? "Tickets on sale now." : "Opens soon."}
      </span>
    </Link>
  );
}
