"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function EventsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[events] render failed", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <ErrorState
        error={error}
        reset={reset}
        title="The events list didn't load"
        description="This is our problem - nothing about ticket availability changed."
        backHref="/"
        backLabel="Back home"
      />
    </main>
  );
}
