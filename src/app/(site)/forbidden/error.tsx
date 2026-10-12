"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function ForbiddenError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[forbidden] render failed", error);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4">
      <ErrorState
        error={error}
        reset={reset}
        title="This page didn't load"
        description="We couldn't check your access just now - this is our problem, not a permissions issue."
        backHref="/"
        backLabel="Back home"
      />
    </main>
  );
}
