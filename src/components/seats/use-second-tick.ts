"use client";

import { useSyncExternalStore } from "react";

/**
 * A one-second clock, shared by every consumer.
 *
 * ── WHY THIS SHAPE, AND NOT useEffect + setInterval ────────────────────────
 * The same reasoning already written out in `hold-banner.tsx` and
 * `events/event-cta.tsx`, now extracted because T33 needs a third copy and
 * three hand-rolled clocks is how they drift:
 *
 *   - `useState` + `setInterval` inside an effect trips React 19's
 *     `set-state-in-effect` rule, which has fired three times in this project.
 *   - `getServerSnapshot` MUST be a fixed value. Reading the real clock during
 *     SSR renders a number that is already wrong by the time it hydrates, which
 *     is a hydration mismatch on a timestamp - the one value a ticketing
 *     product cannot be loose about.
 *   - `getSnapshot` MUST be cached. Returning a fresh `Date.now()` on every
 *     call makes React re-render forever, chasing a number that changed while
 *     it was looking at it. Hence the second-resolution cache below.
 *
 * ── WHY T33 NEEDS A CLOCK AT ALL ───────────────────────────────────────────
 * A hold expiring writes no row (T22), so it broadcasts nothing (T33). The only
 * way a browser can learn that a held seat became free is to watch the expiry
 * timestamp itself. One tick drives every seat on the map - 288 seats do not
 * get 288 timers.
 */

let cachedSecond = -1;

function getClientSnapshot() {
  const second = Math.floor(Date.now() / 1000);
  if (second !== cachedSecond) cachedSecond = second;
  return cachedSecond;
}

/* Zero, always. Any real value here would differ from the client's first read
   and produce a hydration mismatch. Consumers treat 0 as "not yet hydrated"
   and render the server's own view until the first real tick. */
const getServerSnapshot = () => 0;

function subscribe(onChange: () => void) {
  /* 250ms rather than 1000ms so a transition lands within a quarter second of
     the real boundary. The snapshot is still cached per SECOND, so this costs
     four cheap comparisons and at most one re-render per second. */
  const id = setInterval(onChange, 250);
  return () => clearInterval(id);
}

/**
 * Unix seconds, or `0` before hydration.
 *
 * Callers must treat 0 as "do not apply time-based logic yet" rather than as
 * the epoch - see `hold-banner.tsx`, which uses the same convention to avoid
 * rendering `--:--` as a real countdown.
 */
export function useSecondTick(): number {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
