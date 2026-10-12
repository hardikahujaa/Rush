"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function OrganizerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[organizer] render failed", error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-page-b pt-page sm:pt-page-lg">
      <ErrorState
        error={error}
        reset={reset}
        title="This page didn't load"
        description="This is our problem, not yours. Your organizer account is unaffected."
        backHref="/"
        backLabel="Back home"
      />
    </main>
  );
}
