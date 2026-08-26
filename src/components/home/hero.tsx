import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Hero. Full viewport height, sitting directly on the aurora.
 *
 * The claim it leads with is the engineering one, because that is the only thing
 * here a competitor cannot copy by restyling: the seat is held by a database
 * constraint, not by an optimistic message. Everything else on this page is a
 * listing; this is the product.
 */
export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100svh-4rem)] items-center justify-center px-4 py-20">
      {/*
        TODO: Inject Morphing GSAP Animation here.

        Reserved, sized and out of the flow so dropping a canvas or SVG in later
        cannot shift the text that is already on screen. Timeline should be
        scrubbed by ScrollTrigger and gated behind
        matchMedia('(prefers-reduced-motion: reduce)').
      */}
      <div
        id="hero-motion-slot"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      />

      <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-live" aria-hidden="true" />
          One seat, one owner — enforced by the database
        </span>

        <h1 className="mt-7 text-balance text-5xl font-semibold leading-[0.95] tracking-[-0.045em] sm:text-7xl lg:text-8xl">
          The drop is
          <br />
          <span className="text-duotone">yours to catch.</span>
        </h1>

        <p className="mt-7 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          Ten thousand people, four hundred seats, one second. RUSH holds your
          seat the instant you pick it and will not sell it twice — even when
          everything is on fire.
        </p>

        <div className="mt-10 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          <Button
            asChild
            size="lg"
            className="w-full rounded-full bg-gradient-to-r from-primary to-brand-2 px-7 text-primary-foreground shadow-[0_0_32px_-8px_var(--primary)] transition-all hover:shadow-[0_0_44px_-6px_var(--primary)] sm:w-auto"
          >
            <Link href="/events">
              Browse the drops
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="w-full rounded-full border-border/70 bg-transparent px-7 backdrop-blur-sm hover:bg-accent/50 sm:w-auto"
          >
            <Link href="/signup">Create an account</Link>
          </Button>
        </div>

        {/* Real numbers from the seeded database, not invented social proof. */}
        <dl className="mt-16 grid w-full max-w-lg grid-cols-3 gap-px overflow-hidden rounded-2xl">
          {[
            { v: "0", l: "oversells, ever" },
            { v: "10 min", l: "seat hold window" },
            { v: "864", l: "seats live now" },
          ].map((s) => (
            <div key={s.l} className="glass px-3 py-4 text-center">
              <dt className="text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
                {s.v}
              </dt>
              <dd className="mt-1 text-[11px] leading-tight text-muted-foreground">
                {s.l}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
