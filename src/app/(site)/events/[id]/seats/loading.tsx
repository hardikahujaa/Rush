/**
 * Mirrors `events/[id]/seats/page.tsx`'s shape - the heading, the
 * availability line, the tier legend row, and the map's own black box -
 * so the real seat map (and its fixed checkout bar, once something is
 * selected) lands in the same place this skeleton already occupies.
 *
 * `pb-44` matches the real page's bottom padding exactly - see the note on
 * that value in `globals.css`: it clears the fixed checkout bar, which is
 * content-clearance rather than the shared page rhythm, so this has to
 * match it directly rather than through the `pb-page-b` token.
 */
export default function SeatsLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-44 pt-page sm:px-6 sm:pt-page-lg">
      <p role="status" aria-live="polite" className="sr-only">
        Loading the seat map…
      </p>

      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="h-4 w-32 rounded bg-white/[0.04]" />

        <div className="mt-4 h-8 w-56 rounded-lg bg-white/[0.06] sm:h-10 sm:w-72" />
        <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:gap-6">
          <div className="h-4 w-44 rounded bg-white/[0.04]" />
          <div className="h-4 w-36 rounded bg-white/[0.04]" />
        </div>

        <div className="mt-7 h-4 w-48 rounded bg-white/[0.04]" />

        <div className="mt-7 flex flex-wrap gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="glass h-16 min-w-[9.5rem] flex-1 rounded-xl" />
          ))}
        </div>

        <div className="mt-6 h-[50vh] rounded-2xl border border-white/10 bg-black" />
      </div>
    </main>
  );
}
