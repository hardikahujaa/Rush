"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[home] render failed", error);
  }, [error]);

  return (
    <main className="flex min-h-[80svh] flex-col items-center justify-center px-4">
      <ErrorState
        error={error}
        reset={reset}
        title="The homepage didn't load"
        description="This is our problem, not a sign anything is down - try again in a moment."
        backHref="/events"
        backLabel="Browse all events"
      />
    </main>
  );
}
