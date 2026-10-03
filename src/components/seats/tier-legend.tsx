"use client";

import type { TierWithStats } from "@/lib/mock-data";
import { formatPaise } from "@/lib/format";

/**
 * The price key, above the map.
 *
 * `flex-wrap` rather than a grid: tiers vary from three to four and the boxes
 * are content-sized, so a fixed column count would either strand a lone box on
 * its own row or squeeze four into a width meant for three. Wrapping lets the
 * row break wherever it actually runs out of space.
 *
 * The available count here is `tier.stats.available`, the same filter over the
 * same array that produced the number on the landing card and in the pricing
 * table. There is no second source for it to disagree with.
 */
export function TierLegend({ tiers }: { tiers: TierWithStats[] }) {
  return (
    <div className="flex flex-wrap gap-3 sm:gap-4">
      {tiers.map((tier) => {
        const soldOut = tier.stats.available === 0;

        return (
          <div
            key={tier.id}
            /* Glass is permitted here and on the checkout bar only. The map
               floor itself stays pure black - a blurred backdrop behind the
               seating would wash out the hairline architecture. */
            className="glass flex min-w-[9.5rem] flex-1 items-center gap-3 rounded-xl px-3.5 py-3"
          >
            {/* The swatch is a filled square with the tier's border colour, so
                it reads as the same object as the seats it labels. */}
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-[4px] border"
              style={{
                borderColor: tier.color,
                backgroundColor: tier.isStanding ? "transparent" : "#1A1A1A",
                backgroundImage: tier.isStanding
                  ? `repeating-linear-gradient(45deg, ${tier.color}55 0 2px, transparent 2px 5px)`
                  : undefined,
              }}
            />

            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium leading-tight">
                {tier.name}
              </p>
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                <span className="tabular-nums text-gold-champagne">
                  {formatPaise(tier.priceCents)}
                </span>
                {" · "}
                {/* Zero is stated in words, not left as a bare "0 left" that
                    reads like a rendering failure. */}
                {soldOut ? (
                  "Sold out"
                ) : (
                  <span className="tabular-nums">
                    {tier.stats.available} left
                  </span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
