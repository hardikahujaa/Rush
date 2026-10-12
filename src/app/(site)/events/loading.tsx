/**
 * Streamed while `/events` awaits its query (T17 asks for this skeleton).
 *
 * ── WHY A SKELETON AND NOT A SPINNER ───────────────────────────────────────
 * Next renders this instantly and swaps in the real page when the await
 * resolves. Because it mirrors the finished layout - same heading block, same
 * chip row, same 4-column grid, same card aspect ratio - the content lands
 * without the page jumping. A centred spinner would occupy none of the right
 * space and every element would shift when it disappeared.
 *
 * The count is 8 because that is roughly a first viewport of cards; rendering
 * 48 placeholders would push the real footer absurdly far down the document.
 *
 * `animate-pulse` is Tailwind's, which does NOT respect
 * `prefers-reduced-motion` on its own - the media query below is what honours
 * it, matching the approach taken for the hold countdown in T24. A reduced
 * motion user still gets the layout, just without the breathing.
 */
export default function EventsLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      {/* Announced once, so a screen reader is told the page is working rather
          than being read a grid of empty boxes. */}
      <p role="status" aria-live="polite" className="sr-only">
        Loading events…
      </p>

      <div aria-hidden="true" className="motion-safe:animate-pulse">
        {/* heading */}
        <div className="h-9 w-56 rounded-lg bg-white/[0.06] sm:h-10 sm:w-72" />
        <div className="mt-3 h-4 w-40 rounded bg-white/[0.04]" />

        {/* filter chips */}
        <div className="mt-6 flex gap-2">
          {[64, 88, 96, 72].map((w) => (
            <div
              key={w}
              className="h-10 rounded-full bg-white/[0.05]"
              style={{ width: w }}
            />
          ))}
        </div>

        {/* card grid, matching the real one's columns and aspect ratio */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="glass overflow-hidden rounded-2xl"
            >
              <div className="aspect-[3/2] w-full bg-white/[0.05]" />
              <div className="flex flex-col gap-3 p-4">
                <div className="h-3 w-3/4 rounded bg-white/[0.05]" />
                <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
                <div className="mt-1 flex items-center justify-between">
                  <div className="h-4 w-16 rounded bg-white/[0.05]" />
                  <div className="h-3 w-20 rounded bg-white/[0.04]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
