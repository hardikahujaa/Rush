"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * The seat map's error boundary.
 *
 * ── WHY THIS ROUTE GOT ONE FIRST ───────────────────────────────────────────
 * There were no `error.tsx` files anywhere in this app, so any throw below the
 * root rendered Next's default - a bare error page in development and a blank
 * region in production. For most pages that is merely poor; for the seat map it
 * is actively misleading, because a blank seat map is indistinguishable from a
 * sold-out one. Someone staring at an empty grid has no way to tell whether the
 * room is full, the event has no chart, or the page crashed, and all three
 * demand different actions.
 *
 * This states which one it is and offers the one thing that might help.
 *
 * NOTE: this is not the fix for the reported "blank map". That turned out to be
 * sold seats rendering at 1.08:1 contrast - the DOM was full of seats nobody
 * could see, and no error was ever thrown. This boundary exists because the
 * absence of one made that symptom impossible to diagnose from the outside, and
 * because T41 wants these anyway.
 *
 * `error.tsx` must be a client component: it receives the error object and the
 * `reset` callback, and `reset` re-renders the segment in place rather than
 * reloading the document.
 */
export default function SeatsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /* Logged client-side so it is visible in the console during a demo. In
       production the message is redacted by Next and only `digest` survives,
       which is what correlates this to the server log - and to Sentry in T45. */
    console.error("[seats] render failed", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
      <div className="glass rounded-2xl px-6 py-12">
        <AlertTriangle
          className="mx-auto size-7 text-destructive"
          aria-hidden="true"
        />

        <h1 className="text-metal mt-5 text-2xl font-bold tracking-[-0.03em]">
          The seat map didn&rsquo;t load
        </h1>

        <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
          Something went wrong building this chart — this is our problem, not a
          sold-out show.{" "}
          <strong className="font-medium text-foreground">
            No seats were held and nothing was charged.
          </strong>{" "}
          Any hold you already had is still safe and still counting down.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="btn-gold inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold uppercase tracking-wide outline-none transition-[filter] duration-300 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
            Try again
          </button>
          <Link
            href="/"
            className="btn-gold-outline inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to events
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 font-mono text-[10px] text-muted-foreground">
            {/* Selectable so it can be quoted in a bug report. */}
            ref <span className="select-all">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
