"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function QueueError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[queue] render failed", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <ErrorState
        error={error}
        reset={reset}
        title="The waiting room didn't load"
        description="This is our problem, not a lost place in line - a Redis issue here never affects your admission or your seats."
        backHref="/"
        backLabel="Back home"
      />
    </main>
  );
}
