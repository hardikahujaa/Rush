"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";

import { QueueProgress } from "./queue-progress";

/**
 * THE HANDOFF.
 *
 * ── WHY THERE IS A PAUSE BEFORE NAVIGATING ────────────────────────────────
 * PLAN.md asks for a redirect "the instant you're admitted". After a wait that
 * may have run for minutes, an instant snap to another page reads as a crash -
 * the user never sees that they succeeded, only that the thing they were
 * staring at vanished. A beat of about a second lets the success land. The
 * timing lives in `use-queue-position.ts`; this component only paints it.
 *
 * Nothing depends on the pause for correctness. The admission cookie was set by
 * the response that produced this state, so the gate will already let them
 * through - and the link below is a real one, so a navigation that never fires
 * leaves the user one tap from the seats instead of stranded.
 *
 * ── THE ONE PLACE GREEN APPEARS IN THE BUYER FLOW ─────────────────────────
 * Obsidian & Champagne has no green. `#16A34A` exists in exactly one other
 * file, `scan/gate-scanner.tsx`, where a full-bleed green takeover is correct
 * because a bouncer reads it at arm's length in a dark venue. Here it is
 * confined to the check badge: enough to read as "verified" at a glance, while
 * the headline, the bar and the glow stay champagne so the screen still belongs
 * to the rest of the product.
 *
 * Meaning is never carried by colour alone - the badge is a check mark, and the
 * headline says it in words.
 */
export function AdmissionCurtain({ seatsHref }: { seatsHref: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      /* `role="status"` with `aria-live="assertive"`: this is the one moment in
         the lobby that genuinely warrants interrupting. Everything else is
         polite. */
      role="status"
      aria-live="assertive"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="glass relative overflow-hidden rounded-2xl border-gold/35 px-6 py-12 text-center"
    >
      {/*
        The bloom. A champagne glow expanding from behind the badge, which is
        what makes the transition feel like a door opening rather than a panel
        being replaced. Decorative, so `aria-hidden` and gated on reduced
        motion - at which point the gradient simply sits there, still lit.
      */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-16 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/25 blur-3xl"
        initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />

      <div className="relative">
        <motion.div
          initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 20, delay: 0.05 }}
          /* `ring-black/25` because a saturated green disc on near-black needs
             an edge to read as an object rather than a hole. */
          className="mx-auto flex size-14 items-center justify-center rounded-full ring-1 ring-black/25"
          style={{ backgroundColor: "#16A34A" }}
        >
          <Check className="size-7" style={{ color: "#04140A" }} aria-hidden="true" strokeWidth={3} />
        </motion.div>

        <motion.h2
          initial={reduceMotion ? false : { y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.12 }}
          className="text-champagne mt-6 text-3xl font-bold tracking-[-0.03em] sm:text-4xl"
        >
          You&rsquo;re in
        </motion.h2>

        <motion.p
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="mt-2 text-sm text-muted-foreground"
        >
          Opening the seat map&hellip;
        </motion.p>

        {/* The same bar, driven to 100% in champagne. Reusing the component
            rather than drawing a full one is what makes the fill look like it
            completed the journey instead of being swapped for a finished
            picture. */}
        <div className="mx-auto max-w-xs">
          <QueueProgress ahead={0} peak={1} complete />
        </div>

        <Link
          href={seatsHref}
          className="btn-gold mt-6 inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Choose seats
        </Link>
      </div>
    </motion.div>
  );
}
