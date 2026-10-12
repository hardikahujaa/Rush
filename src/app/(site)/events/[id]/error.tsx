"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

/**
 * NOT the same case as `not-found.tsx` in this segment, which handles a
 * genuinely unknown event id via `notFound()` - a controlled, expected
 * outcome. This is for an actual crash rendering a REAL event: a malformed
 * row, a query that threw, a client component failing to mount.
 */
export default function EventError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[events/id] render failed", error);
  }, [error]);

  return (
    <main className="flex min-h-[70svh] flex-col items-center justify-center px-4">
      <ErrorState
        error={error}
        reset={reset}
        title="This event didn't load"
        description="This is our problem, not a sold-out show or a bad link. Nothing was held and nothing was charged."
        backHref="/events"
        backLabel="Browse all events"
      />
    </main>
  );
}
