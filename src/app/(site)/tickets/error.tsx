"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function TicketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[tickets] render failed", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <ErrorState
        error={error}
        reset={reset}
        title="Your tickets didn't load"
        description="This is our problem - your tickets are safe, signed and unaffected. The QR codes are only generated when this page renders them, so nothing was exposed."
        backHref="/"
        backLabel="Back home"
      />
    </main>
  );
}
