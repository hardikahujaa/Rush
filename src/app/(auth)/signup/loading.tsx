/**
 * Same reasoning as `(auth)/login/loading.tsx` - the card chrome is already
 * there from `(auth)/layout.tsx`; this just adds the one extra field
 * `<SignupForm>` has (name, email, password) that login does not.
 */
export default function SignupLoading() {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        Loading sign up…
      </p>
      <div aria-hidden="true" className="motion-safe:animate-pulse space-y-6">
        <div className="space-y-2">
          <div className="h-6 w-36 rounded-lg bg-white/[0.06]" />
          <div className="h-4 w-52 rounded bg-white/[0.04]" />
        </div>
        <div className="space-y-3">
          <div className="h-10 rounded-lg bg-white/[0.05]" />
          <div className="h-10 rounded-lg bg-white/[0.05]" />
          <div className="h-10 rounded-lg bg-white/[0.05]" />
        </div>
        <div className="h-10 rounded-lg bg-white/[0.07]" />
      </div>
    </>
  );
}
