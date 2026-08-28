"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * The scarcity badge.
 *
 * ── WHY THE SIMULATED SALES ARE GONE ───────────────────────────────────────
 * This component used to invent its own decrements on a random timer: it took a
 * starting number and ticked it down every 5-15 seconds, so a card that opened
 * showing "Only 12 seats left" read "Only 9 seats left" within half a minute.
 *
 * Two things were wrong with that, and they are the same thing seen from
 * different angles.
 *
 * It broke the arithmetic. The seat map for that event still contains exactly
 * twelve available seats, because `mock-data.ts` says so. A user who read the
 * badge, clicked through, and counted would find the product contradicting
 * itself - and on a ticketing site, the seat count IS the product.
 *
 * And it was fabricated urgency. A number that falls on a timer regardless of
 * whether anyone is buying is manufactured pressure, which is precisely the dark
 * pattern the honest no-oversell backend exists to avoid.
 *
 * So the number is now a prop, full stop. The flip animation stays, because the
 * value WILL move once Supabase Realtime pushes updates from the `seats` table -
 * at which point every change it renders will correspond to a real sale.
 */
export function SeatCounter({
  seats,
  className,
}: {
  /** The live available count. Computed upstream; never adjusted here. */
  seats: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <span
      className={[
        "flex items-center gap-1.5 rounded-full border border-gold/35 bg-gold/12 px-2.5 py-1 text-[11px] font-medium text-gold-champagne",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      /**
       * Deliberately NOT a live region.
       *
       * Fourteen of these sit on the homepage. Announcing every change would
       * turn a screen reader into a stream of interruptions for a number that is
       * context, not a task the user is performing. The current value is in the
       * accessible name, so it reads correctly whenever someone navigates here.
       */
      /* Pluralised: "Only 1 seats left" is otherwise guaranteed to appear on any
         event down to its last ticket. */
      aria-label={`Only ${seats} ${seats === 1 ? "seat" : "seats"} left`}
    >
      {/* A dot as well as colour, so urgency is not carried by hue alone. */}
      <span
        aria-hidden="true"
        className={[
          "size-1.5 shrink-0 rounded-full bg-gold",
          reduceMotion ? "" : "animate-pulse",
        ].join(" ")}
      />

      <span aria-hidden="true" className="flex items-center gap-1">
        Only
        {/* The slot the digits travel through.
            - overflow-hidden clips the departing number, which would otherwise
              be visible outside the badge on its way out
            - the height is in em so it tracks the font size rather than
              guessing a pixel value that breaks if the badge is ever resized
            - min-w-[2ch] with tabular figures stops the badge from resizing
              mid-swap: popLayout takes the exiting number out of flow, so the
              width would otherwise snap to the entering one and shove
              "seats left" sideways on every 10 -> 9 transition */}
        <span className="relative inline-flex h-[1.35em] min-w-[2ch] items-center justify-center overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              /* Keying on the value is what makes AnimatePresence treat each
                 number as a distinct element to swap, rather than re-rendering
                 one element's text. */
              key={seats}
              initial={reduceMotion ? false : { y: "110%", opacity: 0 }}
              animate={{ y: "0%", opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { y: "-110%", opacity: 0 }}
              transition={{
                y: { type: "spring", stiffness: 420, damping: 34 },
                /* Exit fades faster than entry so the two numbers are never
                   both legible at once - a split-flap shows one face at a time. */
                opacity: { duration: 0.16 },
              }}
              className="block tabular-nums"
            >
              {seats}
            </motion.span>
          </AnimatePresence>
        </span>
        {seats === 1 ? "seat" : "seats"} left
      </span>
    </span>
  );
}
