"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function ScanError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[scan] render failed", error);
  }, [error]);

  return (
    <main className="flex min-h-[70svh] flex-col items-center justify-center px-4">
      <ErrorState
        error={error}
        reset={reset}
        title="The scanner didn't load"
        description="No ticket was scanned and nothing was checked in. Try again, or use the manual code entry once the scanner loads."
        backHref="/"
        backLabel="Back home"
      />
    </main>
  );
}
