"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

/**
 * The one error boundary in this app where the reassurance line matters
 * more than anywhere else. Someone landing here has just paid - a crash
 * rendering the confirmation must not read as "did my payment go through?"
 * `one_sold_seat` and the webhook's idempotency ledger (T28) are what
 * actually decide that, and neither has anything to do with whether this
 * page can draw a success screen; this error boundary firing changes
 * nothing about either.
 */
export default function OrderSuccessError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[orders/success] render failed", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <ErrorState
        error={error}
        reset={reset}
        title="We couldn't display your confirmation"
        description={
          <>
            This is only a display problem.{" "}
            <strong className="font-medium text-foreground">
              If your payment went through, your seat and ticket are safe
            </strong>{" "}
            - check{" "}
            <a
              href="/tickets"
              className="text-gold-champagne underline-offset-4 hover:underline"
            >
              your tickets page
            </a>{" "}
            rather than retrying the payment.
          </>
        }
        backHref="/tickets"
        backLabel="View your tickets"
      />
    </div>
  );
}
