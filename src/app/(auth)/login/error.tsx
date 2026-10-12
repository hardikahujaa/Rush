"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

/**
 * `(auth)/layout.tsx` already provides the card chrome, so this renders
 * without the `max-w-lg` card `ErrorState` normally supplies its own border
 * for - the surrounding card already draws one.
 */
export default function LoginError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[login] render failed", error);
  }, [error]);

  return (
    <ErrorState
      error={error}
      reset={reset}
      bare
      title="Sign in didn't load"
      description="This is our problem. No credentials were submitted."
      backHref="/"
      backLabel="Back home"
    />
  );
}
