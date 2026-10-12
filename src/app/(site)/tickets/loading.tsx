/**
 * Mirrors `tickets/page.tsx`'s shape - the heading, one event group's
 * header, and a 2-column grid of ticket-card-sized blocks.
 */
export default function TicketsLoading() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <p role="status" aria-live="polite" className="sr-only">
        Loading your tickets…
      </p>

      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="h-8 w-44 rounded-lg bg-white/[0.06] sm:h-10" />
        <div className="mt-3 h-4 w-56 rounded bg-white/[0.04]" />

        <div className="mt-10">
          <div className="h-5 w-48 rounded bg-white/[0.05]" />
          <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:gap-6">
            <div className="h-4 w-40 rounded bg-white/[0.04]" />
            <div className="h-4 w-36 rounded bg-white/[0.04]" />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="glass h-40 rounded-2xl border-gold/15" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
