/**
 * Mirrors `organizer/events/[id]/page.tsx`'s shape - the heading, the four
 * stat cards, the two charts, and the recent-orders panel. This page runs
 * SIX concurrent analytics queries on every load (`Promise.all` in the real
 * page), so it is the one dashboard-style page in this app most likely to
 * actually show this skeleton for a perceptible moment rather than flash by.
 */
export default function OrganizerDashboardLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <p role="status" aria-live="polite" className="sr-only">
        Loading dashboard…
      </p>

      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="h-4 w-28 rounded bg-white/[0.04]" />
        <div className="mt-4 h-8 w-64 rounded-lg bg-white/[0.06]" />
        <div className="mt-2 h-4 w-48 rounded bg-white/[0.04]" />

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="glass h-28 rounded-2xl border-gold/15" />
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="glass h-80 rounded-2xl border-gold/15 lg:col-span-3" />
          <div className="glass h-80 rounded-2xl border-gold/15 lg:col-span-2" />
        </div>

        <div className="glass mt-6 h-64 rounded-2xl border-gold/15" />
      </div>
    </main>
  );
}
