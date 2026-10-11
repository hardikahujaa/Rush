"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyChart } from "./sales-over-time-chart";

export type SectionPoint = {
  name: string;
  sellThroughPct: number;
  soldSeats: number;
  totalSeats: number;
};

/** Gold at low sell-through, deepening toward champagne as a section nears
 *  capacity - the bar's own colour reports urgency without a legend. */
function fillFor(pct: number): string {
  if (pct >= 90) return "#FFE4B5";
  if (pct >= 60) return "#F59E0B";
  return "#B45309";
}

/**
 * Sell-through per section, as a bar chart.
 *
 * Ordered by price (`getSectionSellThrough`'s own `ORDER BY price_cents
 * DESC`), so the chart reads top-to-bottom the same way the seat map's legend
 * does - Front, then Middle, then Rear - rather than alphabetically or sorted
 * by the metric itself, which would reorder the bars every time sales moved.
 */
export function SellThroughChart({ data }: { data: SectionPoint[] }) {
  if (data.length === 0) {
    return <EmptyChart message="No sections to report." />;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />

          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />

          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={88}
          />

          <Tooltip
            formatter={(value, _name, item) => {
              const point = item.payload as SectionPoint;
              return [`${point.soldSeats} of ${point.totalSeats} seats (${Number(value)}%)`, "Sell-through"];
            }}
            contentStyle={{
              background: "oklch(0.03 0 0 / 92%)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: "rgba(255,255,255,0.6)" }}
            itemStyle={{ color: "#FFE4B5" }}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />

          <Bar dataKey="sellThroughPct" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={900}>
            {data.map((point) => (
              <Cell key={point.name} fill={fillFor(point.sellThroughPct)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
