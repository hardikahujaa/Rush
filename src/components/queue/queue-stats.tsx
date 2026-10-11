"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * The two numbers that make the wait legible.
 *
 * ── WHY "BUYING NOW" IS SHOWN AS A FRACTION OF CAPACITY ───────────────────
 * `admittedCount / capacity` is the most reassuring honest fact available, and
 * it is already in T34's payload. On its own, "41 ahead of you" says nothing
 * about whether the line is moving. "48 / 50 buying now" says the room is full,
 * which explains the wait; watching it read 47 says a seat just freed, which
 * explains the progress. It converts an opaque wait into an observable system.
 *
 * Both values swap through the same clipped slot pattern as the big ticker, at
 * a size where animating the whole number is right - a two-digit change at 18px
 * does not need per-digit treatment.
 */
function StatNumber({ value, suffix }: { value: number; suffix?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <span className="relative inline-flex h-[1.3em] items-center justify-center overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={reduceMotion ? false : { y: "110%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: "-110%", opacity: 0 }}
          transition={{
            y: { type: "spring", stiffness: 420, damping: 34 },
            opacity: { duration: 0.16 },
          }}
          className="block tabular-nums"
        >
          {value.toLocaleString("en-IN")}
          {suffix}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function QueueStats({
  waitingTotal,
  admittedCount,
  capacity,
}: {
  waitingTotal: number;
  admittedCount: number;
  capacity: number;
}) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-4 text-center">
      <div>
        <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          In line
        </dt>
        <dd className="mt-1 text-lg font-semibold text-foreground">
          <StatNumber value={waitingTotal} />
        </dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Buying now
        </dt>
        <dd className="mt-1 text-lg font-semibold text-foreground">
          <StatNumber value={admittedCount} />
          <span className="text-sm font-normal text-muted-foreground">
            {" / "}
            {capacity.toLocaleString("en-IN")}
          </span>
        </dd>
      </div>
    </dl>
  );
}
