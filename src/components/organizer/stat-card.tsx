"use client";

import type { LucideIcon } from "lucide-react";

import { CountUp } from "./count-up";

/**
 * One of the four headline numbers: revenue, tickets sold, sell-through,
 * check-ins.
 *
 * A thin client wrapper around `CountUp` - the card's chrome (border, label,
 * icon) never changes after mount, only the number does, so only the number
 * needs to be a client component. The dashboard page keeps the data fetch and
 * the surrounding layout server-side; this is the leaf CLAUDE.md's "push
 * client boundaries down" rule is about.
 */
export function StatCard({
  label,
  value,
  format,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  icon: LucideIcon;
  /** A second line under the number - "27 of 96 seats", "4 of 50 scanned". */
  hint?: string;
}) {
  return (
    <div className="glass rounded-2xl border-gold/20 px-5 py-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <Icon className="size-4 shrink-0 text-gold/70" aria-hidden="true" />
      </div>

      <p className="text-metal mt-3 text-3xl font-bold tabular-nums tracking-[-0.02em] sm:text-4xl">
        <CountUp value={value} format={format} />
      </p>

      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
