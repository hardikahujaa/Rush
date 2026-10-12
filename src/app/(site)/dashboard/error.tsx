"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] render failed", error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-page-b pt-page sm:pt-page-lg">
      <ErrorState
        error={error}
        reset={reset}
        title="Your dashboard didn't load"
        description="This is our problem, not yours - nothing about your account or your orders changed."
        backHref="/"
        backLabel="Back home"
      />
    </main>
  );
}
