"use client";

import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

/**
 * A number that counts up from 0 on mount, once.
 *
 * ── WHY FRAMER MOTION AND NOT `react-countup` ──────────────────────────────
 * Framer Motion is already a dependency and already drives this project's
 * other animated numbers - the split-flap digits in `seat-counter.tsx`, the
 * queue lobby's ticker. `animate()` driving a `useMotionValue` does exactly
 * what a count-up library does: interpolate a number over time with an easing
 * curve. Adding a second number-animation package to reach the same result
 * would be the dependency this project's own conventions argue against.
 *
 * ── WHY A MOTION VALUE, NOT `useState` ─────────────────────────────────────
 * `animate()` ticks dozens of times a second. Driving that through `setState`
 * would mean dozens of re-renders a second for every stat card on the page -
 * four cards, each re-rendering the whole subtree, just to update one text
 * node. A `MotionValue` sidesteps the React render loop entirely: `animate()`
 * writes to it directly, and `useTransform` + the `motion.span`'s bound
 * `children` paint the DOM node without going through React's reconciler at
 * all. This is the standard Framer Motion pattern for exactly this problem.
 *
 * ── WHY IT ONLY EVER RUNS ONCE ──────────────────────────────────────────────
 * The brief asks for "count up on mount", not "count up on every re-render" -
 * revalidating the dashboard (a parent Server Component re-fetching numbers)
 * must not replay the animation on numbers that only ticked up slightly. A
 * ref remembers whether this instance has already animated; a prop change
 * after that updates the motion value directly, with no animation, which is
 * the correct behaviour for a live figure that moved while the user was
 * looking at something else.
 */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString("en-IN"),
  className,
}: {
  value: number;
  /** Rendered on every tick, including the final frame. */
  format?: (n: number) => string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(0);
  const text = useTransform(motionValue, (latest) => format(latest));
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current) {
      /* A later value (a revalidated figure) snaps in place - not a second
         count-up, which would read as the number resetting to zero every time
         the dashboard refreshes. */
      motionValue.set(value);
      return;
    }
    hasAnimated.current = true;

    if (reduceMotion) {
      motionValue.set(value);
      return;
    }

    const controls = animate(motionValue, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only when `value` changes; `motionValue`/`reduceMotion` are stable across the component's life.
  }, [value]);

  return <motion.span className={className}>{text}</motion.span>;
}
