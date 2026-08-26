import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";

/**
 * The VIP Lobby hero.
 *
 * Everything here is CSS - no images, no canvas, no WebGL. The room is built
 * from stacked elliptical light bands and radial washes over true black, which
 * means it costs nothing to load, cannot shift layout, and recolours from the
 * gold tokens.
 *
 * DEPTH COMES FROM THE ELLIPSES, NOT FROM SHADOWS. Each ring is an ellipse far
 * wider than it is tall, which is what a circle looks like seen at a shallow
 * angle. Ceiling rings are compressed and sit above the eyeline; floor rings are
 * larger, brighter at the near edge and run off the sides of the frame. That
 * disagreement between the two sets is what reads as a room rather than a
 * pattern.
 *
 * PHASE 2 will inject the 3D ring animation into #gsap-scanning-plane and drive
 * the whole section from #hero-gsap-workspace. Both are reserved and out of the
 * layout flow so adding motion later cannot move anything already on screen.
 */
export function Hero() {
  return (
    <section
      id="hero-gsap-workspace"
      className="relative isolate flex min-h-[120vh] flex-col items-center justify-center overflow-hidden px-4 pb-24 pt-16 grain"
    >
      {/* ── LIGHTING CANVAS ────────────────────────────────────────────────
          Ordered back to front. Everything is aria-hidden: this is scenery,
          and a screen reader announcing eight decorative divs would bury the
          headline. */}

      {/* Ambient warmth pooling toward the centre, so the black is never flat */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-30"
        style={{
          background:
            "radial-gradient(80% 55% at 50% 45%, oklch(0.786 0.153 74 / 0.13), transparent 72%)",
        }}
      />

      {/* CEILING — concentric bands, compressed hard and hung above eyeline */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-14%] -z-20 h-[46vh] w-[132vw] max-w-[1500px] -translate-x-1/2 blur-[2px]"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 50%, transparent 44%, oklch(0.925 0.055 88 / 0.85) 47%, oklch(0.786 0.153 74 / 0.55) 50%, transparent 55%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-9%] -z-20 h-[34vh] w-[96vw] max-w-[1080px] -translate-x-1/2 blur-[1px]"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 50%, transparent 40%, oklch(0.94 0.06 88 / 0.95) 45%, oklch(0.786 0.153 74 / 0.5) 49%, transparent 56%)",
        }}
      />
      {/* Bloom around the ceiling fixture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-16%] -z-30 h-[40vh] w-[70vw] max-w-[820px] -translate-x-1/2 rounded-[50%] opacity-70 blur-[70px]"
        style={{ background: "oklch(0.786 0.153 74 / 0.4)" }}
      />

      {/* SIDE COLUMNS — vertical fluting catching light, cropped by the frame */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[8%] top-[8%] -z-20 hidden h-[62vh] w-[26vw] rotate-[8deg] opacity-45 blur-[1px] md:block"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 9px, oklch(0.786 0.153 74 / 0.5) 9px 10px)",
          maskImage:
            "radial-gradient(70% 60% at 80% 40%, black, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(70% 60% at 80% 40%, black, transparent 78%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[8%] top-[8%] -z-20 hidden h-[62vh] w-[26vw] -rotate-[8deg] opacity-45 blur-[1px] md:block"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 9px, oklch(0.786 0.153 74 / 0.5) 9px 10px)",
          maskImage:
            "radial-gradient(70% 60% at 20% 40%, black, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(70% 60% at 20% 40%, black, transparent 78%)",
        }}
      />

      {/* FLOOR — wider, brighter at the near edge, running off both sides */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-26%] left-1/2 -z-20 h-[62vh] w-[168vw] max-w-[2000px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 50%, transparent 52%, oklch(0.925 0.055 88 / 0.7) 55%, oklch(0.786 0.153 74 / 0.4) 58%, transparent 64%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-16%] left-1/2 -z-20 h-[44vh] w-[124vw] max-w-[1500px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 50%, transparent 48%, oklch(0.94 0.06 88 / 0.8) 52%, oklch(0.786 0.153 74 / 0.35) 56%, transparent 63%)",
        }}
      />
      {/* Reflected pool on the polished floor */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] left-1/2 -z-30 h-[34vh] w-[86vw] max-w-[1100px] -translate-x-1/2 rounded-[50%] opacity-55 blur-[80px]"
        style={{ background: "oklch(0.786 0.153 74 / 0.34)" }}
      />

      {/* Vignette. Guarantees a dark floor under the copy wherever the light
          falls, which is what keeps the text contrast honest. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 50%, transparent 30%, oklch(0 0 0 / 0.55) 78%, oklch(0 0 0 / 0.85) 100%)",
        }}
      />

      {/* ── GSAP INJECTION POINT (Phase 2) ─────────────────────────────────
          Empty by design. Reserved, sized, absolutely positioned and out of
          flow, so mounting the 3D ring animation here cannot reflow the
          headline below it. */}
      <div
        id="gsap-scanning-plane"
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[52vh]"
      />

      {/* ── CONTENT ────────────────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-[13px]">
          <CircleCheck className="size-4 shrink-0 text-gold" aria-hidden="true" />
          <span className="text-gold-champagne">
            One seat, one owner — enforced by the database
          </span>
        </span>

        <h1 className="mt-8 text-balance text-[15vw] font-bold leading-[0.92] tracking-[-0.045em] sm:text-7xl lg:text-[7.5rem]">
          <span className="text-metal block">The drop is</span>
          <span className="text-champagne glow-champagne mt-1 block">
            yours to catch.
          </span>
        </h1>

        <p className="mt-8 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          Ten thousand people, four hundred seats, one second. RUSH holds your
          seat the instant you pick it and will not sell it twice — even during
          peak demand.
        </p>

        <div className="mt-10 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
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
  );
}
