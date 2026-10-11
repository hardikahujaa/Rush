"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { queueMessages, tickerIndex } from "./queue-messages";

/**
 * The rotating status line.
 *
 * ── IT OWNS NO TIMER AND NO STATE ─────────────────────────────────────────
 * `tick` arrives as a prop from the single `useSecondTick()` subscription in
 * `queue-lobby.tsx`, and the index is derived from it. That is deliberate on
 * three counts:
 *
 *   1. `useState` + `setInterval` in an effect is the shape React 19's
 *      `set-state-in-effect` rule refuses, and it has fired five times here.
 *   2. `useSecondTick`'s `subscribe` creates an interval per CONSUMER, so
 *      calling it in each component would start three timers to read one clock.
 *      T33 hit this with 288 seat buttons and settled the convention: call it
 *      once at the top, pass the value down.
 *   3. The ticker and the wait estimate read the same tick, so they cannot
 *      drift apart - which matters because they sit two lines from each other.
 *
 * At `tick === 0` - the server render, and the first client paint - the index is
 * 0 for everybody. Identical markup, no hydration mismatch.
 *
 * ── EVERY LINE IS TRUE ────────────────────────────────────────────────────
 * See the header of `queue-messages.ts`. The liveness is carried by motion that
 * reflects real state; the copy never claims work that is not happening.
 *
 * ── AND IT IS HIDDEN FROM SCREEN READERS ──────────────────────────────────
 * `aria-hidden`, because a live region that changes every four seconds forever
 * is not information, it is an interruption - the user would be unable to hear
 * the position they came for. The one polite live region in the lobby announces
 * position changes only. Same decision `seat-counter.tsx` documents for its
 * fourteen badges.
 */
export function StatusTicker({
  ahead,
  inFlight,
  online,
  tick,
}: {
  ahead: number;
  inFlight: boolean;
  online: boolean;
  tick: number;
}) {
  const reduceMotion = useReducedMotion();

  const messages = queueMessages({ ahead, inFlight, online });
  const index = tickerIndex(tick, messages.length);
  const message = messages[index];

  return (
    <div
      aria-hidden="true"
      /* Fixed height and centred. The lines differ in length and one of them
         wraps on a narrow phone, so without a reserved two-line box the panel
         would breathe in and out every four seconds. */
      className="mt-7 flex min-h-10 items-center justify-center px-2"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={message}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={[
            "text-balance text-center text-xs leading-relaxed",
            /* The live slot is champagne; the standing guidance is quieter, so
               the eye learns which line is reporting and which is advising. */
            index === 0 ? "text-gold-champagne/90" : "text-muted-foreground",
          ].join(" ")}
        >
          {message}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
