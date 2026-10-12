/**
 * `(auth)/layout.tsx` already provides the card chrome around this - only the
 * form's own shape needs sketching here: a heading, two input-sized bars, and
 * a submit-sized bar, matching `<LoginForm>`'s actual fields.
 */
export default function LoginLoading() {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        Loading sign in…
      </p>
      <div aria-hidden="true" className="motion-safe:animate-pulse space-y-6">
        <div className="space-y-2">
          <div className="h-6 w-32 rounded-lg bg-white/[0.06]" />
          <div className="h-4 w-48 rounded bg-white/[0.04]" />
        </div>
        <div className="space-y-3">
          <div className="h-10 rounded-lg bg-white/[0.05]" />
          <div className="h-10 rounded-lg bg-white/[0.05]" />
        </div>
        <div className="h-10 rounded-lg bg-white/[0.07]" />
      </div>
    </>
  );
}
