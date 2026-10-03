/**
 * Display formatting shared by server and client components.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * `formatPaise` used to live in `src/lib/mock-events.ts`, which meant seven
 * CLIENT components imported the mock event catalogue just to format a price.
 * That was harmless while the catalogue was static strings, and stopped being
 * harmless the moment its dates became relative to `Date.now()`: a module
 * evaluated in both the server and the browser computes the clock twice, and
 * the two answers can straddle midnight. Rendering a date from that is a
 * hydration mismatch on the one value a ticketing product must not get wrong.
 *
 * Splitting the formatter out keeps `mock-events.ts` entirely server-side (it
 * is marked `server-only`, which makes that a build error rather than a
 * promise) while the currency helper stays available everywhere.
 *
 * A currency formatter in a file full of placeholder event data was also just
 * in the wrong place.
 */

/** Rs 4,999 from 499900. Grouped in the Indian system. */
export function formatPaise(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}
