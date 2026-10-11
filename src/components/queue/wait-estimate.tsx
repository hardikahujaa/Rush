"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { decayEta, formatEta, formatHeartbeat } from "./queue-display";

/**
 * The wait estimate, and the heartbeat beneath it.
 *
 * ── NO LAYOUT SHIFT, WHICH THE BRIEF CALLED OUT ───────────────────────────
 * Two traps here, and T34 fell into the first. The estimate starts as null -
 * nothing has been admitted yet, so there is no measured rate - and swapping
 * `null` for a value by mounting and unmounting the line moves everything below
 * it. Both rows therefore have a reserved `min-h` and are ALWAYS mounted; only
 * their text content is swapped, through `AnimatePresence` in `wait` mode so
 * the outgoing line finishes leaving before the incoming one arrives.
 *
 * ── WHY THE NUMBER MOVES BETWEEN POLLS ────────────────────────────────────
 * At the back of a long line, polls are twelve seconds apart. A frozen "about
 * four minutes" for twelve seconds is the single most reliable way to convince
 * somebody the page has died and reach for refresh - the exact load the queue
 * exists to absorb. So the estimate decays every second, driven by the shared
 * clock, and the decay is capped so it can never march to zero while polls are
 * failing. See `decayEta`.
 *
 * `tick === 0` means not yet hydrated, and every function here returns its
 * server-identical answer for it - which is what makes the first client paint
 * match the server HTML.
 */
export function WaitEstimate({
  etaSeconds,
  lastOkAt,
  tick,
  inFlight,
  nextUp,
}: {
  etaSeconds: number | null;
  lastOkAt: number;
  tick: number;
  inFlight: boolean;
  /** Nobody ahead. The estimate stops mattering and the instruction starts. */
  nextUp: boolean;
}) {
  const reduceMotion = useReducedMotion();

  const decayed = decayEta(etaSeconds, lastOkAt, tick);
  const heartbeat = formatHeartbeat(lastOkAt, tick, inFlight);

  const line = nextUp
    ? "A spot is about to open — stay on this page."
    : decayed === null
      ? "Estimated wait: calculating…"
      : `Estimated wait: ${formatEta(decayed)}`;

  return (
    <>
      <div className="mt-4 flex min-h-5 items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            /* Keyed on the TEXT, not the raw seconds. The estimate changes
               every second but its rendered bucket changes every minute or so -
               keying on seconds would re-animate an identical string sixty
               times a minute, which is both wasteful and visibly jittery. */
            key={line}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="text-sm text-muted-foreground"
          >
            {line}
          </motion.p>
        </AnimatePresence>
      </div>

      {/*
        THE HONEST HEARTBEAT.

        This is the line that does the job the brief wanted a fake ticker for.
        It reports something literally true - when we last heard back, and
        whether a request is open right now - and because it reads from the
        one-second clock it is visibly alive without claiming any work that is
        not happening. Reserved height: it is absent before the first poll.
      */}
      <div className="flex min-h-4 items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          {heartbeat && (
            <motion.p
              key={heartbeat}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground/70"
            >
              <span
                aria-hidden="true"
                className={[
                  "size-1 shrink-0 rounded-full",
                  inFlight ? "bg-gold" : "bg-gold/40",
                ].join(" ")}
              />
              {heartbeat}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
