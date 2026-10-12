/**
 * Mirrors `events/[id]/page.tsx`'s three sections - the hero band with the
 * title pulled up over it, the CTA card, and the pricing list - so the real
 * page lands without shifting anything beneath it.
 */
export default function EventLoading() {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        Loading event…
      </p>

      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="relative h-[52vh] w-full bg-white/[0.04] sm:h-[60vh]" />

        <div className="relative z-10 mx-auto -mt-20 max-w-5xl px-4 sm:-mt-24 sm:px-6">
          <div className="h-6 w-28 rounded-full bg-white/[0.08]" />
          <div className="mt-5 h-10 w-3/4 rounded-lg bg-white/[0.08] sm:h-14" />
          <div className="mt-4 h-5 w-1/2 rounded bg-white/[0.05]" />
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:gap-6">
            <div className="h-4 w-48 rounded bg-white/[0.04]" />
            <div className="h-4 w-40 rounded bg-white/[0.04]" />
          </div>
        </div>

        <div className="mx-auto mt-14 max-w-5xl px-4 sm:px-6">
          <div className="glass h-28 rounded-3xl border-gold/15" />
        </div>

        <div className="mx-auto mt-14 max-w-5xl px-4 pb-24 sm:px-6">
          <div className="h-6 w-40 rounded-lg bg-white/[0.06]" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="glass h-16 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
