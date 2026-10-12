/**
 * Streamed while the homepage awaits its two `getEventCards()` calls.
 *
 * The hero itself (`<SpotlightHero>`) has no data dependency - it is pure
 * markup - so skeletonising it would flash a grey box in front of an
 * animation that was going to render immediately regardless. This mirrors
 * only the part that is actually waiting on a query: the two event rails,
 * in the same card-grid shape `events/loading.tsx` already established for
 * the full listing page, so the two loading states feel like one pattern
 * rather than two different ideas.
 */
function RailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="h-3 w-24 rounded bg-white/[0.05]" />
      <div className="mt-2 h-8 w-64 rounded-lg bg-white/[0.06]" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass overflow-hidden rounded-2xl">
            <div className="aspect-[3/2] w-full bg-white/[0.05]" />
            <div className="flex flex-col gap-3 p-4">
              <div className="h-3 w-3/4 rounded bg-white/[0.05]" />
              <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomeLoading() {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        Loading events…
      </p>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        {/* A dark band standing in for the hero's own height, so the rails
            below land at roughly the same scroll position they will in the
            real page - without redrawing an animation that isn't waiting
            on anything. */}
        <div className="h-[70svh] w-full bg-black" />
        <RailSkeleton />
        <RailSkeleton />
      </div>
    </>
  );
}
