/**
 * T40's type-scale piece, and why it is a component rather than a Tailwind
 * theme key.
 *
 * ── THE BRIEF SAYS "IN THE TAILWIND CONFIG" - THIS IS THE ONE PIECE THAT ISN'T ─
 * Tailwind v4 genuinely supports naming a font size in `@theme`
 * (`--text-page-title: …` generates a `text-page-title` utility, with
 * optional `--text-page-title--line-height` / `--text-page-title--letter-
 * spacing` companions) - and the obvious alternative to this file was to
 * override the EXISTING `--text-3xl` / `--text-4xl` keys with this
 * heading's leading and tracking, since the four duplicated pages all
 * compose `text-3xl … sm:text-4xl` already.
 *
 * That alternative was tried and rejected after checking who else uses those
 * two keys: `grep -rl "text-3xl\|text-4xl" src` turns up fourteen files -
 * stat cards, the success page, the admission curtain, the gate scanner's
 * verdict screen, standing-zone pricing - none of which are this heading.
 * Overriding the base scale to fix four pages would have silently reshaped
 * the leading and tracking of all fourteen, which is the opposite of a
 * consistency pass: it would introduce ten new inconsistencies to remove
 * four.
 *
 * A component sidesteps that entirely - importing `<PageTitle>` cannot
 * accidentally change anything that does not import it.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 * Before this, the exact string
 * `"text-metal text-balance text-3xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-4xl"`
 * was copy-pasted verbatim into `events/page.tsx`, `tickets/page.tsx`,
 * `events/[id]/queue/page.tsx` and `organizer/events/[id]/page.tsx` - four
 * independent places a future tweak has to find and edit identically, or it
 * silently drifts into a fifth variant. `seats/page.tsx` had ALREADY
 * drifted, one step, to `sm:text-5xl` - evidence of exactly the failure mode
 * this file exists to close off.
 *
 * `<PageTitle size="hero">` is `events/[id]/page.tsx`'s larger tier -
 * `text-4xl … sm:text-6xl lg:text-7xl`, `leading-[1.02] tracking-[-0.04em]` -
 * which was never duplicated anywhere else, but is named here as a sibling
 * rather than left as an unrelated one-off, since the two sizes are visibly
 * the same typographic family at different emphasis.
 */
import { cn } from "@/lib/utils";

const SIZES = {
  page: "text-balance text-3xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-4xl",
  hero: "text-balance text-4xl font-bold leading-[1.02] tracking-[-0.04em] sm:text-6xl lg:text-7xl",
} as const;

export function PageTitle({
  size = "page",
  className,
  children,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h1 className={cn("text-metal", SIZES[size], className)}>{children}</h1>
  );
}
