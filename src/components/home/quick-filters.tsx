import Link from "next/link";

import { CATEGORIES } from "@/lib/taxonomy";

/**
 * Horizontal category rail.
 *
 * Scrolls with `snap-x` so a flick lands on a chip rather than between two.
 * Scrollbars are hidden but the scroll itself is untouched — keyboard, trackpad
 * and touch all still work, and each chip is a real link, so tab order carries
 * you through them in order.
 */
export function QuickFilters() {
  return (
    <section className="relative py-2" aria-label="Browse by category">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <Link
                key={cat.slug}
                href={`/events?category=${cat.slug}`}
                className="group/chip glass flex shrink-0 snap-start items-center gap-2.5 rounded-full py-2.5 pl-3 pr-4 outline-none transition-all duration-300 hover:-translate-y-0.5 hover:[--glass-bg:oklch(1_0_0_/_11%)] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: `oklch(0.7 0.2 ${cat.hue} / 0.16)`,
                  }}
                >
                  <Icon
                    className="size-3.5"
                    style={{ color: `oklch(0.8 0.16 ${cat.hue})` }}
                    aria-hidden="true"
                  />
                </span>
                <span className="whitespace-nowrap text-sm font-medium text-foreground/90">
                  {cat.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
