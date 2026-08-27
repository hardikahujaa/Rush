"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, BellPlus } from "lucide-react";

/**
 * The wall clock, exposed as an external store.
 *
 * The obvious implementation is useState plus setInterval inside useEffect. That
 * pattern trips React 19's `set-state-in-effect` rule - which has already fired
 * twice in this project - and it also forces a choice between rendering a
 * countdown during SSR (guaranteed wrong by the time it reaches the browser, so
 * a hydration mismatch) or flashing an empty slot.
 *
 * useSyncExternalStore solves both: the clock is a mutable value the outside
 * world owns, and the server snapshot is a fixed 0, so SSR renders a stable
 * placeholder and the clock only starts once hydrated.
 *
 * getSnapshot MUST be cached or React re-renders forever chasing a number that
 * changed while it was looking at it - hence the second-resolution cache.
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
  // Polled faster than 1s so the display never lags a tick behind the wall
  // clock. React skips the re-render when the snapshot is unchanged.
  const id = setInterval(onChange, 250);
  return () => clearInterval(id);
}

function useNowSeconds() {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

const pad = (n: number) => String(n).padStart(2, "0");

function Unit({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-champagne text-4xl font-bold leading-none tabular-nums sm:text-5xl lg:text-6xl">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function Separator() {
  return (
    <span
      aria-hidden="true"
      className="text-champagne pb-6 text-3xl font-light leading-none opacity-40 sm:text-4xl"
    >
      :
    </span>
  );
}

/**
 * The call to action: a countdown before the drop, a live button after it.
 *
 * `dropAtIso` rather than a Date - only serialisable values cross the boundary
 * from a server component.
 */
export function EventCTA({
  dropAtIso,
  eventId,
  soldOut,
}: {
  dropAtIso: string;
  eventId: string;
  soldOut: boolean;
}) {
  const target = new Date(dropAtIso).getTime();
  const nowSeconds = useNowSeconds();

  /* Null until hydrated, which is what keeps the server and client markup
     identical. */
  const remaining = nowSeconds === 0 ? null : Math.max(0, target - nowSeconds * 1000);
  const dropped = remaining !== null && remaining === 0;

  /* Sold out beats every other state. Counting down to a release for an event
     with no seats left would be a straightforward lie. */
  if (soldOut) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          This show is sold out
        </p>
        <button
          type="button"
          className="btn-gold-outline inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[15px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BellPlus className="size-4" aria-hidden="true" />
          Notify me if seats are released
        </button>
      </div>
    );
  }

  /* Before hydration the countdown has no honest value to show, so the slot is
     reserved at its final height instead of collapsing and shifting the page. */
  if (remaining === null) {
    return <div aria-hidden="true" className="h-[104px] sm:h-[116px] lg:h-[128px]" />;
  }

  if (dropped) {
    return (
      <div className="flex flex-col items-center gap-4">
        <span className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-live">
          <span className="relative flex size-2" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-70" />
            <span className="relative inline-flex size-2 rounded-full bg-live" />
          </span>
          On sale now
        </span>

        <Link
          href={`/events/${eventId}/seats`}
          className="btn-gold inline-flex h-16 w-full max-w-lg items-center justify-center gap-3 rounded-2xl px-10 text-lg font-bold uppercase tracking-wide outline-none transition-[filter,box-shadow] duration-300 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background sm:text-xl"
          style={{
            boxShadow:
              "inset 0 1px 0 0 oklch(1 0 0 / 45%), 0 0 60px -10px oklch(0.786 0.153 74 / 85%)",
          }}
        >
          Live: secure your seats
          <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="flex flex-col items-center gap-5">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Tickets release in
      </p>

      {/* aria-hidden on the digits: this changes every second, and a screen
          reader announcing it would talk over everything else on the page. The
          same information is given once, as a sentence, below. */}
      <div aria-hidden="true" className="flex items-start gap-3 sm:gap-5">
        <Unit value={pad(days)} label="Days" />
        <Separator />
        <Unit value={pad(hours)} label="Hours" />
        <Separator />
        <Unit value={pad(minutes)} label="Mins" />
        <Separator />
        <Unit value={pad(seconds)} label="Secs" />
      </div>

      <p className="sr-only">
        Tickets release in {days} days, {hours} hours and {minutes} minutes.
      </p>

      <button
        type="button"
        className="btn-gold-outline inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BellPlus className="size-4" aria-hidden="true" />
        Remind me before the drop
      </button>
    </div>
  );
}
