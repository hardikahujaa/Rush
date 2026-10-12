export default function ForbiddenLoading() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <p role="status" aria-live="polite" className="sr-only">
        Checking your access…
      </p>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mx-auto size-10 rounded-full bg-white/[0.06]" />
        <div className="mx-auto mt-6 h-7 w-72 rounded-lg bg-white/[0.06]" />
        <div className="mx-auto mt-3 h-4 w-56 rounded bg-white/[0.04]" />
      </div>
    </main>
  );
}
