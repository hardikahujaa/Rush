"use client";

import { motion, useReducedMotion } from "framer-motion";

import { progressOf } from "./queue-display";

/**
 * How far this person has come.
 *
 * ── THE TRACK IS RENDERED FROM THE FIRST PAINT ────────────────────────────
 * T34 mounted this only once `peak > 0`, so the bar appeared a second or two
 * after the panel and pushed everything below it down - a layout shift on the
 * one screen where the user is watching intently for any sign of change. The
 * track is now always present and the fill carries a 2% floor, so the
 * difference between "no data yet" and "no progress yet" is a sliver of gold
 * rather than an element arriving.
 *
 * ── A SPRING, NOT A LINEAR TWEEN ──────────────────────────────────────────
 * `width` is animated by Framer Motion rather than by a CSS transition because
 * a spring settle is what makes the movement feel like a mechanism rather than
 * a progress meter. It overshoots very slightly and comes to rest, which reads
 * as something physical having moved. Width is not a compositor-friendly
 * property, but this is ONE element changing a few times a minute - the
 * calculus that made T33 use CSS transitions for 288 seat buttons does not
 * apply to a single bar.
 */
export function QueueProgress({
  ahead,
  peak,
  /** Admitted: fill to 100% in champagne and stop. */
  complete = false,
}: {
  ahead: number;
  peak: number;
  complete?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const progress = complete ? 1 : progressOf(ahead, peak);
  const percent = Math.round(progress * 100);

  return (
    <div className="mt-8">
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Queue progress"
      >
        <motion.div
          className={[
            "h-full rounded-full",
            complete
              ? "bg-gradient-to-r from-gold via-gold-bright to-gold-champagne"
              : "bg-gradient-to-r from-gold-deep via-gold to-gold-champagne",
          ].join(" ")}
          initial={false}
          /* The 2% floor keeps a visible sliver at zero progress. A bar of
             literally no width looks like a bar that failed to render. */
          animate={{ width: `${Math.max(2, progress * 100)}%` }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : complete
                ? { type: "spring", stiffness: 120, damping: 20 }
                : { type: "spring", stiffness: 90, damping: 22 }
          }
        />

        {/*
          The leading edge glow. Purely decorative, and it claims nothing - it
          simply marks where the fill currently ends, which is what stops the
          bar from looking like a flat painted rectangle. Hidden at the floor,
          where it would sit outside the track.
        */}
        {progress > 0.02 && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-champagne/70 blur-[3px]"
            initial={false}
            animate={{ left: `${Math.max(2, progress * 100)}%` }}
            transition={
              reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 90, damping: 22 }
            }
          />
        )}
      </div>

      {/* Reserved height so the caption cannot shift the panel when `peak`
          arrives on the first poll. */}
      <p className="mt-2 flex min-h-4 items-center justify-center text-center text-[11px] text-muted-foreground">
        {peak > 0 && !complete
          ? `${percent}% of the way — you started ${peak.toLocaleString("en-IN")} back`
          : ""}
      </p>
    </div>
  );
}
