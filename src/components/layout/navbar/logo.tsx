import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The RUSH wordmark. Pure code - no image, no icon font, no SVG asset.
 *
 * The mark is four bars that lean forward at 12 degrees and climb in height.
 * Read one way it is a level meter with demand rising; read another it is speed
 * lines. Both are the product. The leading bar is dim and the last two carry the
 * duotone, so the eye travels left to right and lands on the accent - the same
 * direction the word is read in.
 *
 * The gap between bars is deliberately tighter than the bars are wide, which is
 * what makes a group of rectangles read as motion rather than as a chart.
 *
 * On hover a highlight sweeps across the letters once. It is 1.1s, runs on
 * transform only, and is disabled under prefers-reduced-motion by the global
 * rule in globals.css.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="RUSH — home"
      className={cn(
        "group/logo relative flex shrink-0 items-center gap-2.5 rounded-lg outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        className,
      )}
    >
      {/* The mark */}
      <span
        aria-hidden="true"
        className="flex h-6 items-end gap-[3px] [transform:skewX(-12deg)]"
      >
        <span className="h-2 w-[3px] rounded-[1px] bg-foreground/25 transition-all duration-300 group-hover/logo:h-3" />
        <span className="h-3.5 w-[3px] rounded-[1px] bg-foreground/45 transition-all duration-300 group-hover/logo:h-4" />
        <span className="h-[18px] w-[3px] rounded-[1px] bg-primary transition-all duration-300 group-hover/logo:h-5" />
        <span className="h-6 w-[3px] rounded-[1px] bg-brand-2 transition-all duration-300 group-hover/logo:h-[26px]" />
      </span>

      {/* The word. `overflow-hidden` clips the sweep to the text box. */}
      <span className="relative overflow-hidden">
        <span className="block text-[19px] font-bold leading-none tracking-[-0.055em] text-foreground">
          RUSH
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-1/2 hidden w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-foreground/55 to-transparent group-hover/logo:block group-hover/logo:animate-sweep"
        />
      </span>
    </Link>
  );
}
