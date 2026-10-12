/**
 * Covers only the server-side wait for `getOrderForUser` before
 * `<SuccessView>` mounts - the payment-confirmation polling after that is
 * `<SuccessView>`'s own client-side state, not this page's Suspense
 * boundary, so this skeleton is deliberately brief: a crest-shaped circle
 * and two text lines, matching the shape the real page settles into either
 * way.
 */
export default function OrderSuccessLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center sm:px-6 sm:py-16">
      <p role="status" aria-live="polite" className="sr-only">
        Loading your order…
      </p>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mx-auto size-16 rounded-full bg-white/[0.06]" />
        <div className="mx-auto mt-6 h-9 w-56 rounded-lg bg-white/[0.06]" />
        <div className="mx-auto mt-3 h-4 w-72 rounded bg-white/[0.04]" />
      </div>
    </div>
  );
}
