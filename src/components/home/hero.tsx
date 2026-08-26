"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * The VIP Lobby hero, with the scroll-driven scanner.
 *
 * ── WHY perspective SITS ON THE PINNED SECTION, NOT A WRAPPER ──────────────
 * The brief asked for a perspective container wrapping the hero. That cannot
 * work with `pin: true`. ScrollTrigger resolves pinType as:
 *
 *   "pinType" in vars ? vars.pinType : _getProxyProp(...) || isViewport && "fixed"
 *
 * so with the viewport as scroller it pins using `position: fixed` - and a
 * `perspective` ancestor becomes the containing block for fixed descendants,
 * which silently converts the pin into an absolutely-positioned element that
 * scrolls away. The section would simply not pin.
 *
 * Putting `perspective` on the pinned section itself avoids the conflict
 * entirely: an element may be both a perspective root and position:fixed, and
 * the ring is a child, so it still rotates in real 3D space. Same visual
 * result, no broken pin.
 *
 * ── WHY THE SECTION IS 100svh, NOT 120vh ───────────────────────────────────
 * A pinned element taller than the viewport can never show its lower portion:
 * it is frozen at `top top`, so the bottom 20vh - which is where the CTAs sit -
 * would be unreachable for the entire pinned scroll. The scroll distance the
 * 120vh was providing now comes from `end: "+=150%"` instead.
 *
 * ── REFS, NOT SELECTORS ────────────────────────────────────────────────────
 * Every animated node is a React ref. The ambient lighting is wrapped in one
 * container so the blackout is a single tween on a single ref rather than eight.
 * The IDs remain on the elements as stable anchors for tooling, but GSAP never
 * looks anything up by string.
 */
export function Hero() {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const hero = heroRef.current;
      const ring = ringRef.current;
      const ambient = ambientRef.current;
      if (!hero || !ring || !ambient) return;

      /**
       * matchMedia rather than a bare timeline.
       *
       * Ambient motion is decorative by definition, so it is the first thing to
       * go when someone has asked their OS for less of it. Under reduced motion
       * the section does not pin and does not scrub - it renders the resolved
       * end state immediately, which stays readable and costs no scroll.
       * GSAP reverts each context automatically when the query stops matching.
       */
      const mm = gsap.matchMedia();

      mm.add(
        {
          full: "(prefers-reduced-motion: no-preference)",
          reduced: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const { reduced } = context.conditions as { reduced: boolean };

          if (reduced) {
            gsap.set(ring, { rotateX: 76, yPercent: 120, opacity: 0.5 });
            return;
          }

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: hero,
              start: "top top",
              end: "+=150%",
              scrub: 1,
              pin: hero,
              // Compensates for the one-frame jump some browsers show when a
              // pin engages during fast scrolling.
              anticipatePin: 1,
              /* Distances are read from the viewport, so they must be recomputed
                 on resize rather than baked in at first paint. */
              invalidateOnRefresh: true,
            },
          });

          /* THE BLACKOUT — one tween, one ref. Eased `power2.in` so the room
             holds its light for the first part of the scroll and then drops
             away quickly, rather than dimming linearly from the first pixel. */
          tl.to(ambient, { opacity: 0, ease: "power2.in", duration: 1 }, 0);

          /* THE DESCENT AND TILT — the ring sweeps down through the headline
             while rotating back, so it reads as a plane passing over the text
             rather than a circle sliding down a flat page.

             `y` is a function so `invalidateOnRefresh` can recompute it on
             resize; a hard-coded pixel value would be wrong on every viewport
             but the one it was authored on. Easing is `none` because the scroll
             position IS the clock - adding a curve here would make the ring lag
             or lead the user's own scrubbing. */
          tl.to(
            ring,
            {
              y: () => window.innerHeight * 0.52,
              rotateX: 78,
              scale: 1.45,
              ease: "none",
              duration: 1,
            },
            0,
          );

          /* The halo brightens as it crosses the text, then settles - the scan
             reads as a light source doing something, not a shape moving. */
          tl.to(ring, { opacity: 1, duration: 0.45, ease: "none" }, 0)
            .to(ring, { opacity: 0.62, duration: 0.55, ease: "none" }, 0.45);
        },
      );

      /**
       * MEASURE AFTER MOUNT — this is not optional in the App Router.
       *
       * ScrollTrigger computes start/end when it is created and again on the
       * window "load" event. A client component in the App Router hydrates
       * AFTER load has already fired, so that automatic refresh never covers
       * this trigger: it is created against a layout that is still settling and
       * resolves "end" to null, which silently produces a zero-length pin.
       * Symptom is a pin-spacer with 0px padding and progress stuck at 0.
       *
       * A frame later the layout is real, so re-measure then.
       */
      const raf = requestAnimationFrame(() => ScrollTrigger.refresh());

      /* Web fonts swapping in changes the height of every text block above the
         fold, which moves every start/end measured before the swap. Re-measure
         once they have settled. */
      let cancelled = false;
      document.fonts?.ready.then(() => {
        if (!cancelled) ScrollTrigger.refresh();
      });

      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    },
    { scope: rootRef },
  );

  return (
    /* No perspective on this wrapper - see the note above. It exists purely as
       the useGSAP scope root. */
    <div ref={rootRef}>
      <section
        id="hero-gsap-workspace"
        ref={heroRef}
        className="grain relative isolate flex h-svh flex-col items-center justify-center overflow-hidden px-4 [perspective:1000px] [transform-style:preserve-3d]"
      >
        {/* ── AMBIENT LIGHTING ────────────────────────────────────────────
            All of it inside one wrapper so the blackout is a single tween on a
            single ref. aria-hidden throughout: this is scenery, and a screen
            reader announcing eight decorative divs would bury the headline. */}
        <div ref={ambientRef} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(80% 55% at 50% 45%, oklch(0.786 0.153 74 / 0.13), transparent 72%)",
            }}
          />

          {/* CEILING — compressed hard, hung above the eyeline */}
          <div
            className="absolute left-1/2 top-[-14%] h-[46vh] w-[132vw] max-w-[1500px] -translate-x-1/2 blur-[2px]"
            style={{
              background:
                "radial-gradient(ellipse 50% 50% at 50% 50%, transparent 44%, oklch(0.925 0.055 88 / 0.85) 47%, oklch(0.786 0.153 74 / 0.55) 50%, transparent 55%)",
            }}
          />
          <div
            className="absolute left-1/2 top-[-9%] h-[34vh] w-[96vw] max-w-[1080px] -translate-x-1/2 blur-[1px]"
            style={{
              background:
                "radial-gradient(ellipse 50% 50% at 50% 50%, transparent 40%, oklch(0.94 0.06 88 / 0.95) 45%, oklch(0.786 0.153 74 / 0.5) 49%, transparent 56%)",
            }}
          />
          <div
            className="absolute left-1/2 top-[-16%] h-[40vh] w-[70vw] max-w-[820px] -translate-x-1/2 rounded-[50%] opacity-70 blur-[70px]"
            style={{ background: "oklch(0.786 0.153 74 / 0.4)" }}
          />

          {/* SIDE COLUMNS — vertical fluting catching light, cropped by frame */}
          <div
            className="absolute -left-[8%] top-[8%] hidden h-[62vh] w-[26vw] rotate-[8deg] opacity-45 blur-[1px] md:block"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, transparent 0 9px, oklch(0.786 0.153 74 / 0.5) 9px 10px)",
              maskImage: "radial-gradient(70% 60% at 80% 40%, black, transparent 78%)",
              WebkitMaskImage: "radial-gradient(70% 60% at 80% 40%, black, transparent 78%)",
            }}
          />
          <div
            className="absolute -right-[8%] top-[8%] hidden h-[62vh] w-[26vw] -rotate-[8deg] opacity-45 blur-[1px] md:block"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, transparent 0 9px, oklch(0.786 0.153 74 / 0.5) 9px 10px)",
              maskImage: "radial-gradient(70% 60% at 20% 40%, black, transparent 78%)",
              WebkitMaskImage: "radial-gradient(70% 60% at 20% 40%, black, transparent 78%)",
            }}
          />

          {/* FLOOR — wider, brighter at the near edge, running off both sides */}
          <div
            className="absolute bottom-[-26%] left-1/2 h-[62vh] w-[168vw] max-w-[2000px] -translate-x-1/2"
            style={{
              background:
                "radial-gradient(ellipse 50% 50% at 50% 50%, transparent 52%, oklch(0.925 0.055 88 / 0.7) 55%, oklch(0.786 0.153 74 / 0.4) 58%, transparent 64%)",
            }}
          />
          <div
            className="absolute bottom-[-16%] left-1/2 h-[44vh] w-[124vw] max-w-[1500px] -translate-x-1/2"
            style={{
              background:
                "radial-gradient(ellipse 50% 50% at 50% 50%, transparent 48%, oklch(0.94 0.06 88 / 0.8) 52%, oklch(0.786 0.153 74 / 0.35) 56%, transparent 63%)",
            }}
          />
          <div
            className="absolute bottom-[-10%] left-1/2 h-[34vh] w-[86vw] max-w-[1100px] -translate-x-1/2 rounded-[50%] opacity-55 blur-[80px]"
            style={{ background: "oklch(0.786 0.153 74 / 0.34)" }}
          />
        </div>

        {/* Vignette. Kept OUTSIDE the ambient wrapper so it survives the
            blackout - it is what guarantees a dark floor under the copy, and
            fading it would raise the background as the room goes dark. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(70% 50% at 50% 50%, transparent 30%, oklch(0 0 0 / 0.55) 78%, oklch(0 0 0 / 0.85) 100%)",
          }}
        />

        {/* ── THE SCANNER RING ────────────────────────────────────────────
            z-20 puts it above the headline (z-10), so it passes physically OVER
            the text rather than behind it. pointer-events-none so a halo sitting
            on top of the CTAs can never eat a click. */}
        <div
          id="gsap-scanning-plane"
          ref={ringRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[6vh] z-20 h-[26vh] w-[78vw] max-w-[900px] -translate-x-1/2 rounded-[100%] border border-[#FACC15]/60 opacity-80 shadow-[0_0_60px_rgba(250,204,21,0.4),inset_0_0_60px_rgba(250,204,21,0.25)] will-change-transform"
          style={{ transformStyle: "preserve-3d" }}
        />

        {/* ── CONTENT ───────────────────────────────────────────────────── */}
        <div
          className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center text-center"
        >
          <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-[13px]">
            <CircleCheck className="size-4 shrink-0 text-gold" aria-hidden="true" />
            <span className="text-gold-champagne">
              One seat, one owner — enforced by the database
            </span>
          </span>

          <h1 className="mt-8 text-balance text-[13vw] font-bold leading-[0.92] tracking-[-0.045em] sm:text-7xl lg:text-[7rem]">
            <span className="text-metal block">The drop is</span>
            <span className="text-champagne glow-champagne mt-1 block">
              yours to catch.
            </span>
          </h1>

          <p className="mt-7 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            Ten thousand people, four hundred seats, one second. RUSH holds your
            seat the instant you pick it and will not sell it twice — even during
            peak demand.
          </p>

          <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/events"
              className="btn-gold inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-7 text-[15px] font-semibold outline-none transition-[filter,box-shadow] duration-300 hover:brightness-[1.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
            >
              Browse the drops
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/signup"
              className="btn-gold-outline inline-flex h-12 w-full items-center justify-center rounded-xl px-7 text-[15px] font-medium outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
            >
              Create an account
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
