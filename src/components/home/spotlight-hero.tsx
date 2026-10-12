"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { Spotlight } from "@/components/home/spotlight-new";

/**
 * THE HERO (T39).
 *
 * Replaces the GSAP scanner-ring hero wholesale, per the T39 directive's own
 * framing ("replace the functional T17 homepage") - that was a pinned,
 * scroll-scrubbed 3D ring with its own `matchMedia` reduced-motion path, and
 * it is gone, not merged alongside this. The headline copy and the trust
 * badge survive unchanged; only the background treatment and the entrance
 * animation changed.
 *
 * ── THE SPOTLIGHT IS RECOLOURED AT THE CALL SITE, NOT IN THE INSTALLED FILE ─
 * `components/home/spotlight-new.tsx` ships from Aceternity with a blue
 * `hsla(210, …)` default. Editing the installed file directly would make a
 * future `npx shadcn diff` noisy for no reason; the component already takes
 * `gradientFirst`/`gradientSecond`/`gradientThird` as props, so the Obsidian &
 * Champagne hue (38°, derived from this project's own `--gold` /
 * `--gold-champagne` tokens - #F59E0B and #FFE4B5, both already hue ≈38° -
 * rather than picked independently) is supplied here instead.
 *
 * ── WHY THE STAGGERED REVEAL IS WORD-LEVEL, NOT LINE-LEVEL ─────────────────
 * `AnimatePresence`/`variants` with `staggerChildren` cascading across five
 * words reads as a title assembling itself, which is the "staggered text
 * reveal" the brief asks for. Splitting further to letters would be the same
 * technique turned into noise on a four-word headline - that trick earns its
 * keep on a single short word, not a full sentence.
 */

const WORDS = ["The", "drop", "is", "yours", "to", "catch."];

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
};

const word = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

export function SpotlightHero() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="grain relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4">
      {/* Pure black base so the champagne spotlight reads as light cast INTO
          a dark room, rather than a tint over a grey one. */}
      <div aria-hidden="true" className="absolute inset-0 -z-20 bg-black" />

      <Spotlight
        gradientFirst="radial-gradient(68.54% 68.72% at 55.02% 31.46%, hsla(38, 100%, 85%, .14) 0, hsla(38, 92%, 50%, .05) 50%, hsla(38, 92%, 50%, 0) 80%)"
        gradientSecond="radial-gradient(50% 50% at 50% 50%, hsla(38, 100%, 85%, .10) 0, hsla(38, 92%, 50%, .04) 80%, transparent 100%)"
        gradientThird="radial-gradient(50% 50% at 50% 50%, hsla(38, 100%, 85%, .07) 0, hsla(38, 92%, 50%, .03) 80%, transparent 100%)"
      />

      {/* The same vignette the GSAP hero used, kept verbatim - it is what
          guarantees a dark floor under the copy regardless of what the
          spotlight above it is doing. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 50%, transparent 30%, oklch(0 0 0 / 0.55) 78%, oklch(0 0 0 / 0.85) 100%)",
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <motion.span
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-[13px]"
        >
          <CircleCheck className="size-4 shrink-0 text-gold" aria-hidden="true" />
          <span className="text-gold-champagne">
            One seat, one owner — enforced by the database
          </span>
        </motion.span>

        <motion.h1
          initial="hidden"
          animate="visible"
          variants={reduceMotion ? undefined : container}
          className="mt-8 text-balance text-[13vw] font-bold leading-[0.92] tracking-[-0.045em] sm:text-7xl lg:text-[7rem]"
        >
          <span className="text-metal block">
            {WORDS.slice(0, 3).map((w, i) => (
              <motion.span key={i} variants={reduceMotion ? undefined : word} className="inline-block">
                {w}
                {i < 2 ? " " : ""}
              </motion.span>
            ))}
          </span>
          <span className="text-champagne glow-champagne mt-1 block">
            {WORDS.slice(3).map((w, i) => (
              <motion.span
                key={i}
                variants={reduceMotion ? undefined : word}
                className="inline-block"
              >
                {w}
                {i < WORDS.length - 4 ? " " : ""}
              </motion.span>
            ))}
          </span>
        </motion.h1>

        <motion.p
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="mt-7 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base"
        >
          Ten thousand people, four hundred seats, one second. RUSH holds your
          seat the instant you pick it and will not sell it twice — even during
          peak demand.
        </motion.p>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.85 }}
          className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row"
        >
          {/*
            Magic UI's ShimmerButton hardcodes a <button> root with no
            polymorphic `as` prop (see shimmer-button.tsx), and a <button>
            nested inside next/link's <a> is invalid HTML - two interactive
            elements, one inside the other, which also confuses screen
            readers about what actually activates on click. Rather than
            nest them, this reproduces ShimmerButton's own internal markup
            - the spark container, the highlight, the backdrop, the same
            CSS custom properties - directly under the <Link>, so the <a>
            IS the shimmering surface instead of wrapping a second
            clickable one. The installed component itself is unmodified;
            only this call site needed the anchor instead of a button.

            `motion-safe:` on both `animate-*` classes: the installed file
            has no reduced-motion handling at all, which this project gates
            on everywhere else a loop runs forever (seat-button's pulse,
            `.live-pulse`'s border).
          */}
          <Link
            href="/events"
            style={
              {
                "--spread": "90deg",
                "--shimmer-color": "#FFE4B5",
                "--radius": "0.75rem",
                "--speed": "2.5s",
                "--cut": "0.05em",
              } as CSSProperties
            }
            className="group relative z-0 inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-7 text-[15px] font-semibold text-background [background:linear-gradient(170deg,var(--gold-champagne)_0%,var(--gold)_55%,var(--gold-deep)_100%)] transition-[filter] duration-300 hover:brightness-[1.06] sm:w-auto"
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-30 overflow-visible blur-[2px] @container-[size]"
            >
              <span className="motion-safe:animate-shimmer-slide absolute inset-0 aspect-square h-[100cqh] rounded-none [mask:none]">
                <span className="motion-safe:animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
              </span>
            </span>

            View Live Drops
            <ArrowRight
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden="true"
            />

            <span
              aria-hidden="true"
              className="absolute inset-0 size-full rounded-xl shadow-[inset_0_-8px_10px_#ffffff1f] transition-all duration-300 ease-in-out group-hover:shadow-[inset_0_-6px_10px_#ffffff3f] group-active:shadow-[inset_0_-10px_10px_#ffffff3f]"
            />
          </Link>

          <Link
            href="/signup"
            className="btn-gold-outline inline-flex h-12 w-full items-center justify-center rounded-xl px-7 text-[15px] font-medium outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
          >
            Create an account
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
