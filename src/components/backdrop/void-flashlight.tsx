"use client";

import { useEffect, useRef } from "react";

/** Radius of the lit pool, in px. */
const RADIUS = 400;

/**
 * The mask and the paint both read the same two custom properties, so one write
 * per frame moves the light.
 *
 * The var() fallbacks are not cosmetic. An undefined custom property makes the
 * whole radial-gradient invalid at parse time, which drops the mask entirely and
 * exposes the raw grid across the full viewport - a loud failure from a silent
 * cause. The fallbacks keep the light parked at centre instead.
 */
const MASK = `radial-gradient(circle ${RADIUS}px at var(--mouse-x, 50vw) var(--mouse-y, 50vh), rgba(0,0,0,1), transparent 80%)`;

/**
 * The Void Flashlight.
 *
 * A milled architectural grid is painted across the whole viewport in near-black
 * and then almost entirely masked away. Only a 400px pool around the cursor
 * survives the mask, so the grid reads as something that was always there in the
 * dark rather than as an effect that switches on.
 *
 * ── WHY THE CURSOR NEVER TOUCHES REACT STATE ───────────────────────────────
 * `mousemove` fires far faster than React can usefully re-render. Putting the
 * coordinates in state would re-render this component - and reconcile its
 * subtree - on every single pointer event, for a value that only ever feeds two
 * CSS custom properties. Writing them straight to the node in a rAF is the
 * whole optimisation: React renders this once, and the browser moves the light.
 *
 * ── WHY ONE ELEMENT, NOT TWO ───────────────────────────────────────────────
 * The gold wash and the grid are layered background-images on a single masked
 * node. Two separately-masked layers would mean two full-viewport repaints per
 * frame instead of one, for an identical result.
 *
 * ── RELATIONSHIP TO THE GSAP TIMELINE ──────────────────────────────────────
 * This is `position: fixed`, so it contributes no height and cannot alter the
 * measurements ScrollTrigger takes when it pins the hero. It sits at z-index -1
 * inside the site layout's stacking context, which puts it above the page ground
 * but beneath every section, including the pinned hero and its scanner ring.
 */
export function VoidFlashlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /**
     * A light that follows a cursor needs a cursor. On touch there is nothing to
     * follow, so the effect would strand a lit circle wherever the last tap
     * landed. Better to not run at all.
     *
     * `any-pointer` rather than `pointer`: a touchscreen laptop reports its
     * PRIMARY pointer as coarse even with a mouse plugged in, and those users
     * should still get the effect.
     */
    if (!window.matchMedia("(any-pointer: fine)").matches) return;

    const el = ref.current;
    if (!el) return;

    let x = 0;
    let y = 0;
    let frame = 0;

    const flush = () => {
      frame = 0;
      el.style.setProperty("--mouse-x", `${x}px`);
      el.style.setProperty("--mouse-y", `${y}px`);
    };

    const onMove = (event: MouseEvent) => {
      x = event.clientX;
      y = event.clientY;
      /**
       * Coalesce to one write per frame. Pointer events can arrive several
       * times per frame on a high-polling mouse; without this guard each one
       * would schedule its own callback and invalidate style repeatedly for a
       * position that is about to be overwritten anyway.
       */
      if (!frame) frame = requestAnimationFrame(flush);
    };

    window.addEventListener("mousemove", onMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[-1]"
      style={
        {
          /**
           * Seeded to the centre of the viewport. These are rendered into the
           * markup identically on the server and the client, so there is nothing
           * for hydration to disagree about - the effect only starts writing
           * real coordinates after mount.
           */
          "--mouse-x": "50vw",
          "--mouse-y": "50vh",
          backgroundImage: [
            // Champagne warmth over the lit area, laid on top of the grid.
            "linear-gradient(rgba(250, 204, 21, 0.03), rgba(250, 204, 21, 0.03))",
            "linear-gradient(to right, #333 1px, transparent 1px)",
            "linear-gradient(to bottom, #333 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "100% 100%, 40px 40px, 40px 40px",
          maskImage: MASK,
          WebkitMaskImage: MASK,
        } as React.CSSProperties
      }
    />
  );
}
