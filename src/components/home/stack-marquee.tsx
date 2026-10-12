"use client";

import { useReducedMotion } from "framer-motion";

import { Marquee } from "@/components/home/marquee";
import { STACK_ICONS } from "@/components/home/stack-icons";

/**
 * The tech-stack strip under "Engineered for Scale".
 *
 * ── WHY MONOCHROME, NOT EACH BRAND'S OWN COLOUR ────────────────────────────
 * `simple-icons` ships each mark's real brand hex (extracted at build time
 * into `stack-icons.ts` - see that file for why it is not a runtime import),
 * and Next.js's is literal black (`#000000`) - invisible against this page's
 * near-black background. Rendering every mark in one soft tone
 * (`currentColor`, inherited from a muted-foreground class) rather than five
 * mismatched brand colours is also just the better fit for Obsidian &
 * Champagne: a quiet, monochrome "built with" row that does not compete with
 * the gold the rest of the page spends its colour budget on. Each mark
 * brightens individually on hover, which is where the brand-recognition
 * moment actually belongs.
 *
 * ── WHY THE MARQUEE ITSELF STAYS UNEDITED ──────────────────────────────────
 * `components/home/marquee.tsx` has no `prefers-reduced-motion` handling of
 * its own - true of the installed file as shipped. Rather than hand-edit it
 * (making a future `npx shadcn diff` noisy), this wrapper checks
 * `useReducedMotion` itself and renders a static, wrapped row of the same
 * logos when motion is off, instead of an infinite scroll nobody asked for.
 */

const STACK = [
  { key: "nextdotjs", label: "Next.js" },
  { key: "postgresql", label: "Postgres" },
  { key: "redis", label: "Redis" },
  { key: "stripe", label: "Stripe" },
  { key: "resend", label: "Resend" },
] as const;

function Logo({ keyName, label }: { keyName: keyof typeof STACK_ICONS; label: string }) {
  return (
    <span
      className="mx-8 flex items-center gap-2.5 text-muted-foreground/60 transition-colors duration-300 hover:text-gold-champagne"
      title={label}
    >
      <svg
        role="img"
        aria-label={label}
        viewBox="0 0 24 24"
        className="size-6 shrink-0 fill-current"
      >
        <path d={STACK_ICONS[keyName].path} />
      </svg>
      <span className="text-sm font-medium tracking-tight">{label}</span>
    </span>
  );
}

export function StackMarquee() {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-y-4 py-2">
        {STACK.map(({ key, label }) => (
          <Logo key={key} keyName={key} label={label} />
        ))}
      </div>
    );
  }

  return (
    <Marquee pauseOnHover className="[--duration:28s]">
      {STACK.map(({ key, label }) => (
        <Logo key={key} keyName={key} label={label} />
      ))}
    </Marquee>
  );
}
