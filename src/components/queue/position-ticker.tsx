"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * The number people screenshot.
 *
 * ── PER-DIGIT, NOT PER-NUMBER ─────────────────────────────────────────────
 * `components/home/seat-counter.tsx` established this split-flap pattern -
 * `AnimatePresence mode="popLayout"`, keyed on the value, clipped by
 * `overflow-hidden` - and animates the whole number as one unit. That is right
 * for an 11px badge and wrong at 72px: `412 -> 411` would throw all three
 * digits into the air to change one of them, which reads as a slot machine
 * rather than a departures board.
 *
 * So each digit is its own slot and only the ones that actually changed move.
 *
 * ── KEYED BY POSITION FROM THE RIGHT ──────────────────────────────────────
 * The key is `${placeFromRight}-${digit}`, not `${index}-${digit}`. Numbers
 * shrink from the left, so left-anchored indices would renumber every digit
 * when `100` becomes `99` and animate all of them. Counting from the right
 * keeps the units column the units column, so only the vanishing hundreds slot
 * animates out.
 *
 * ── WHY THE WIDTH IS IN `ch` ──────────────────────────────────────────────
 * `popLayout` takes the exiting digit out of flow, so without a reserved width
 * the row would collapse to the entering digit and shove everything sideways on
 * every change. `tabular-nums` makes `1ch` an honest measure of a digit box.
 */
export function PositionTicker({ ahead }: { ahead: number }) {
  const reduceMotion = useReducedMotion();
  const next = ahead === 0;

  /* The accessible name is on the live region in `queue-lobby.tsx`. These
     digits are decoration of a number already announced there - announcing them
     again would read the figure twice, once as a word and once digit by digit. */
  return (
    <div
      aria-hidden="true"
      className="text-metal mt-2 flex items-end justify-center text-6xl font-bold leading-none tracking-[-0.04em] tabular-nums sm:text-7xl"
    >
      {next ? (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key="next"
            initial={reduceMotion ? false : { y: "60%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "-60%", opacity: 0 }}
            transition={{
              y: { type: "spring", stiffness: 380, damping: 30 },
              opacity: { duration: 0.18 },
            }}
            className="block"
          >
            Next
          </motion.span>
        </AnimatePresence>
      ) : (
        String(ahead)
          .split("")
          .map((digit, index, all) => {
            const placeFromRight = all.length - 1 - index;
            return (
              <span
                key={placeFromRight}
                /* One clipped slot per digit. `h` in em so it tracks the font
                   size rather than guessing a pixel height that breaks at the
                   sm: breakpoint. */
                className="relative inline-flex h-[1.05em] w-[0.62ch] items-center justify-center overflow-hidden"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={`${placeFromRight}-${digit}`}
                    initial={reduceMotion ? false : { y: "105%", opacity: 0 }}
                    animate={{ y: "0%", opacity: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { y: "-105%", opacity: 0 }}
                    transition={{
                      y: { type: "spring", stiffness: 420, damping: 32 },
                      /* Exit fades faster than entry, so two digits are never
                         both legible at once - a split-flap shows one face. */
                      opacity: { duration: 0.16 },
                    }}
                    className="block"
                  >
                    {digit}
                  </motion.span>
                </AnimatePresence>
              </span>
            );
          })
      )}
    </div>
  );
}
