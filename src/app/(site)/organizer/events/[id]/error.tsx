"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function OrganizerDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[organizer/events/id] render failed", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <ErrorState
        error={error}
        reset={reset}
        title="This dashboard didn't load"
        description="This is our problem - none of your event's data, orders, or revenue were affected. Only this report failed to render."
        backHref="/organizer"
        backLabel="Back to organizer"
      />
    </main>
  );
}
