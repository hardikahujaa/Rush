"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * T40 — page transitions.
 *
 * ── WHY A `template.tsx` AND NOT SOMETHING IN `layout.tsx` ─────────────────
 * Next's App Router gives exactly one file that remounts on every navigation
 * within a segment: `template.tsx`. `layout.tsx` persists across navigations
 * by design - it is why `<Navbar>` and the flashlight backdrop in
 * `(site)/layout.tsx` do not re-run their mount logic on every click - so an
 * entrance animation placed there would only ever play once, on first load.
 * `template.tsx` sits one level inside `layout.tsx`, wrapping the same
 * `children`, and is handed a fresh instance - and therefore a fresh
 * `initial` state - every time the route changes.
 *
 * ── WHY THIS IS AN ENTRANCE, NOT A CROSSFADE ────────────────────────────────
 * A full crossfade needs the OUTGOING page kept mounted opposite the
 * incoming one (typically `AnimatePresence` keyed on pathname, sitting above
 * where the unmount happens) - which the App Router does not do by default,
 * and forcing it would mean lifting `usePathname()` into a client wrapper
 * above every page, including ones with their own heavy data fetches still
 * in flight. A one-sided entrance - fade and rise in, nothing animates out -
 * costs none of that: the new page simply arrives the way every other
 * reveal in this codebase does (`Reveal` in `components/home/reveal.tsx`,
 * T39's staggered headline), rather than introducing a second, heavier
 * transition mechanism for the one thing that changes between pages.
 *
 * ── WHY NOT ON THE QUEUE LOBBY OR SEAT MAP TRANSITIONS SPECIFICALLY ────────
 * This wraps every route under `(site)` uniformly, including both of those -
 * there is nothing page-specific here to opt in or out of. A page that wants
 * no entrance motion (none currently do) would need its own `template.tsx`
 * in a nested segment, which none of this app's segments need yet.
 */
export default function SiteTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
