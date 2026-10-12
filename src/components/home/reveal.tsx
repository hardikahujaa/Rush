"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The thinnest possible client boundary for a scroll-reveal.
 *
 * ── WHY THIS EXISTS INSTEAD OF MAKING `EventRail` A CLIENT COMPONENT ───────
 * `whileInView` needs a client component somewhere in the tree, and the
 * obvious place is to slap `"use client"` on `EventRail` itself. That would
 * drag `EventCard` - and the `getEventCards()` data it renders - into the
 * client bundle for no reason: CLAUDE.md's rule is to push the client
 * boundary as far DOWN the tree as it will go, and here it goes all the way
 * down to a wrapper that does nothing but animate. `EventRail` and
 * `EventCard` stay exactly as they were - server-rendered, no new bundle
 * weight, no re-fetch on the client.
 *
 * ── `once: true` ────────────────────────────────────────────────────────
 * Without it, scrolling an already-revealed card back into view re-triggers
 * the fade-in every time - which reads as the page re-rendering rather than
 * as a one-time reveal. A card that has been seen stays visible.
 */
export function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  /** Seconds. Staggers a row of cards so they cascade rather than pop as one. */
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}
