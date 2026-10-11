"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatPaise } from "@/lib/format";

export type SalesPoint = {
  hour: string;
  revenueCents: number;
  cumulativeRevenueCents: number;
};

/**
 * Cumulative revenue over the drop, as an area chart.
 *
 * ── CUMULATIVE, NOT PER-HOUR ───────────────────────────────────────────────
 * `getSalesOverTime` returns both an hourly figure and a running total; this
 * chart draws the running total. A per-hour bar is the right shape for "when
 * did people buy" and a WRONG shape for "how is the drop going" - a single
 * dominant spike in the first five minutes would dwarf every later hour on
 * the same axis and flatten the rest of the line into noise. The cumulative
 * curve answers the question an organizer is actually watching this screen
 * for: is the room filling.
 *
 * ── WHY `ResponsiveContainer`, GIVEN THE PROJECT'S USUAL FRAMER MOTION ─────
 * Recharts manages its own SVG layout and resize observation; wrapping it in
 * `ResponsiveContainer` is how it is meant to be sized, not a departure from
 * this project's usual Tailwind sizing. The container below gives it a fixed
 * height and Recharts fills the width.
 *
 * ── TOOLTIP THEMING ─────────────────────────────────────────────────────────
 * Recharts renders its tooltip as a plain DOM node outside Tailwind's utility
 * classes, so the surface is styled with inline `contentStyle`/`itemStyle`
 * rather than `className` - the one place in this component tree a style prop
 * is correct instead of a smell.
 */
export function SalesOverTimeChart({ data }: { data: SalesPoint[] }) {
  if (data.length === 0) {
    return <EmptyChart message="No sales yet — the chart fills in as tickets sell." />;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rush-revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            stroke="rgba(255,255,255,0.06)"
            vertical={false}
          />

          <XAxis
            dataKey="hour"
            tickFormatter={(iso: string) =>
              new Date(iso).toLocaleTimeString("en-IN", {
                hour: "numeric",
                hour12: true,
                timeZone: "Asia/Kolkata",
              })
            }
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            tickLine={false}
            /* Dense hourly data on a long-running event would otherwise paint
               an unreadable comb of labels - Recharts thins them to fit. */
            minTickGap={32}
          />

          <YAxis
            tickFormatter={(cents: number) => formatPaise(cents)}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />

          <Tooltip
            formatter={(value) => [formatPaise(Number(value)), "Total revenue"]}
            labelFormatter={(label) =>
              new Date(String(label)).toLocaleString("en-IN", {
                weekday: "short",
                hour: "numeric",
                hour12: true,
                timeZone: "Asia/Kolkata",
              })
            }
            contentStyle={{
              background: "oklch(0.03 0 0 / 92%)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: "rgba(255,255,255,0.6)", marginBottom: 2 }}
            itemStyle={{ color: "#FFE4B5" }}
          />

          <Area
            type="monotone"
            dataKey="cumulativeRevenueCents"
            stroke="#F59E0B"
            strokeWidth={2}
            fill="url(#rush-revenue-fill)"
            isAnimationActive
            animationDuration={900}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-xs text-muted-foreground">
      {message}
    </div>
  );
}
