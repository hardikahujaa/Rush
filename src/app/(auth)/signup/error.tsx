"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function SignupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[signup] render failed", error);
  }, [error]);

  return (
    <ErrorState
      error={error}
      reset={reset}
      bare
      title="Sign up didn't load"
      description="This is our problem. No account was created."
      backHref="/"
      backLabel="Back home"
    />
  );
}
