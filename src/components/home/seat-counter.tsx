"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/** Sales arrive irregularly, so the interval is re-rolled after every tick. */
const MIN_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15_000;

/** Never reach zero: a card claiming "0 seats left" is a card nobody can buy. */
const FLOOR = 1;

const randomDelay = () =>
  MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);

/**
 * Live seat counter.
 *
 * ⚠ SIMULATED. The decrements here are invented on a timer - no seat is
 * actually being sold. That is acceptable only because every card on this page
 * renders mock data. Before this reaches real events it must be driven by the
 * real availability figure, or the badge becomes fabricated sales pressure
 * against real buyers, which is exactly the dark pattern the honest seat count
 * was there to avoid.
 *
 * The swap is deliberately a one-prop change: replace `initial` with a value
 * pushed from Supabase Realtime on the `seats` table and delete the effect. The
 * rendering below does not care where the number came from.
 */
export function SeatCounter({
  initial,
  className,
}: {
  initial: number;
  className?: string;
}) {
  const [seats, setSeats] = useState(initial);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (seats <= FLOOR) return;

    /**
     * A self-rescheduling timeout, not setInterval.
     *
     * setInterval would lock every card to one fixed cadence, so all fourteen
     * would tick in lockstep and read as a global animation rather than
     * independent sales. Re-rolling the delay after each tick keeps them
     * uncorrelated.
     */
    const id = setTimeout(() => {
      setSeats((current) => {
        if (current <= FLOOR) return current;
        const sold = Math.random() < 0.75 ? 1 : 2;
        return Math.max(FLOOR, current - sold);
      });
    }, randomDelay());

    return () => clearTimeout(id);
  }, [seats]);

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
       * Fourteen of these tick independently. Announcing each change would turn
       * a screen reader into a stream of interruptions for a number that is
       * decorative urgency, not a task the user is performing. The current value
       * is in the accessible name, so it reads correctly whenever someone
       * actually navigates here.
       */
      /* Pluralised, because the floor is 1 and "Only 1 seats left" is therefore
         guaranteed to appear on every card that bottoms out. */
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
