import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Armchair, CalendarCheck, QrCode, Receipt } from "lucide-react";

import {
  getAvgHoldToPurchase,
  getCheckInStats,
  getConversionFunnel,
  getEventHeader,
  getEventRevenue,
  getSalesOverTime,
  getSectionSellThrough,
} from "@/db/queries/analytics";
import { requireRole } from "@/lib/auth";
import { formatPaise } from "@/lib/format";

import { PageTitle } from "@/components/layout/page-title";
import { RecentOrders } from "@/components/organizer/recent-orders";
import { SalesOverTimeChart } from "@/components/organizer/sales-over-time-chart";
import { SellThroughChart } from "@/components/organizer/sell-through-chart";
import { StatCard } from "@/components/organizer/stat-card";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  /* `noindex`: a per-organizer sales dashboard, never a page a search engine
     should surface. */
  return { title: "Event dashboard", robots: { index: false, follow: false } };
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

/**
 * THE ORGANIZER DASHBOARD (T37).
 *
 * A server component that fetches every number ONCE, on render, and hands
 * static data to client leaves - CLAUDE.md's "prefer server components, push
 * client boundaries down" rule applied to a page that is almost entirely
 * read-only. The one genuinely live piece, the recent-orders feed, is its own
 * small client component with its own poll loop; everything else re-renders
 * only when the page itself is revisited or revalidated.
 *
 * ── SIX READS, SIX INDEPENDENT OWNERSHIP CHECKS, BY DESIGN ─────────────────
 * Every function in `analytics.ts` re-verifies that THIS organizer owns THIS
 * event before running its query - there is no single "load the event, then
 * trust it" step here that the others skip. That looks like six redundant
 * database round trips where one would do, and it is a deliberate trade: a
 * page-level gate followed by six functions that assume it already happened
 * is exactly the kind of drift T36's own module note warns about - the one
 * function that is ever called from a NEW context (say, a future API route)
 * without going through this page's gate would quietly become the hole. Six
 * checks that cannot disagree cost more SQL and zero correctness risk.
 *
 * `Promise.all` runs all six concurrently, so the cost is one round trip's
 * worth of latency, not six.
 */
export default async function OrganizerEventDashboard({ params }: Props) {
  const { id: eventId } = await params;
  const user = await requireRole("organizer");

  const [header, revenue, sellThrough, salesOverTime, funnel, avgHold, checkIns] =
    await Promise.all([
      getEventHeader(eventId, user.id),
      getEventRevenue(eventId, user.id),
      getSectionSellThrough(eventId, user.id),
      getSalesOverTime(eventId, user.id),
      getConversionFunnel(eventId, user.id),
      getAvgHoldToPurchase(eventId, user.id),
      getCheckInStats(eventId, user.id),
    ]);

  /* Any one of these being `null` means the same thing - this event does not
     exist, or it is not this organizer's. The two cases are indistinguishable
     on purpose; see the module note in `analytics.ts`. */
  if (!header || !revenue || !sellThrough || !salesOverTime || !funnel || !avgHold || !checkIns) {
    notFound();
  }

  const overallSellThroughPct =
    sellThrough.reduce((sum, s) => sum + s.totalSeats, 0) === 0
      ? 0
      : Math.round(
          (sellThrough.reduce((sum, s) => sum + s.soldSeats, 0) /
            sellThrough.reduce((sum, s) => sum + s.totalSeats, 0)) *
            1000,
        ) / 10;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <Link
        href="/organizer"
        className="inline-flex items-center gap-2 rounded-full py-2 text-sm text-foreground/75 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to organizer
      </Link>

      <header className="mt-4">
        <PageTitle>{header.title}</PageTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          {header.venue}, {header.city} · {formatDate(header.startsAt)}
        </p>
      </header>

      {/* ── the four stat cards ──────────────────────────────────────────── */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Revenue"
          value={revenue.revenueCents}
          format={(n) => formatPaise(n)}
          icon={Receipt}
          hint={`${revenue.paidOrders} paid ${revenue.paidOrders === 1 ? "order" : "orders"}`}
        />
        <StatCard
          label="Tickets sold"
          value={checkIns.ticketsSold}
          icon={Armchair}
          hint={`${overallSellThroughPct}% sell-through`}
        />
        <StatCard
          label="Check-ins"
          value={checkIns.checkedIn}
          icon={QrCode}
          hint={
            checkIns.ticketsSold === 0
              ? "No tickets sold yet"
              : `${checkIns.checkedIn} of ${checkIns.ticketsSold} scanned`
          }
        />
        <StatCard
          label="Conversion"
          value={funnel.conversionRatePct}
          format={(n) => `${n.toFixed(1)}%`}
          icon={CalendarCheck}
          hint={
            funnel.holdsCreated === 0
              ? "No holds yet"
              : `${funnel.holdsConverted} of ${funnel.holdsCreated} holds · avg ${formatSeconds(avgHold.avgSeconds)} to buy`
          }
        />
      </div>

      {/* ── the two charts ───────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="glass rounded-2xl border-gold/20 p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold text-foreground">Sales over time</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Cumulative revenue since the drop</p>
          <div className="mt-4">
            <SalesOverTimeChart
              data={salesOverTime.map((p) => ({
                hour: p.hour.toISOString(),
                revenueCents: p.revenueCents,
                cumulativeRevenueCents: p.cumulativeRevenueCents,
              }))}
            />
          </div>
        </div>

        <div className="glass rounded-2xl border-gold/20 p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-foreground">Sell-through by section</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Sold against each section&rsquo;s capacity</p>
          <div className="mt-4">
            <SellThroughChart
              data={sellThrough.map((s) => ({
                name: s.name,
                sellThroughPct: s.sellThroughPct,
                soldSeats: s.soldSeats,
                totalSeats: s.totalSeats,
              }))}
            />
          </div>
        </div>
      </div>

      {/* ── recent orders, the one live panel ────────────────────────────── */}
      <div className="glass mt-6 rounded-2xl border-gold/20 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent orders</h2>
          <span
            aria-hidden="true"
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span className="size-1.5 rounded-full bg-gold motion-safe:animate-pulse" />
            updates automatically
          </span>
        </div>
        <div className="mt-2">
          <RecentOrders eventId={eventId} />
        </div>
      </div>
    </main>
  );
}
