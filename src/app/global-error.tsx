"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * T41 — the LAST resort. Catches an error thrown in `app/layout.tsx` itself,
 * or anywhere above every other `error.tsx` boundary in this app.
 *
 * ── WHY THIS FILE MUST DEFINE ITS OWN `<html><body>` ────────────────────────
 * Every other `error.tsx` in this app renders INSIDE the root layout, which
 * is still standing - it can rely on `app/layout.tsx` having already painted
 * `<html className="dark">` and `<body>`. `global-error.tsx` is what Next
 * renders when THAT layout is what failed, so there is no outer `<html>` or
 * `<body>` left to rely on; this one has to supply both itself, or the error
 * page would have nothing to mount into.
 *
 * ── WHY NO SHARED COMPONENTS ─────────────────────────────────────────────
 * `ErrorState`, the `cn()` helper, the gold/champagne CSS tokens - all of it
 * assumes `globals.css` has been loaded and the tree below a working root
 * layout. If the root layout is what broke, trusting any of that is the same
 * mistake that got us here. This file is deliberately self-contained: inline
 * styles, no imports beyond React and an icon, so it has the best chance of
 * rendering something even when the rest of the app cannot.
 *
 * ── WHY IT IS STILL DARK, EVEN THOUGH `globals.css` ISN'T LOADED ───────────
 * Inline `style` on the `<body>`, not a class - this cannot assume the
 * Tailwind build even ran.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] root layout failed", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          textAlign: "center",
          background: "#000",
          color: "#fff",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Something went wrong
        </h1>
        <p
          style={{
            marginTop: "0.75rem",
            maxWidth: "26rem",
            fontSize: "0.875rem",
            lineHeight: 1.6,
            color: "rgba(255,255,255,0.65)",
          }}
        >
          This is our problem, not yours. Nothing was charged and no seat was
          held.
        </p>
        <div style={{ marginTop: "1.75rem", display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              height: "2.75rem",
              padding: "0 1.25rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#F59E0B",
              color: "#0A0A0A",
              fontSize: "0.875rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {/* A plain anchor, not next/link's `<Link>`, and deliberately so:
              this file exists for the case where the root layout - and
              everything the App Router's client-side router depends on - is
              what is broken. A real, unconditional page navigation is the
              one thing guaranteed to work regardless. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              height: "2.75rem",
              padding: "0 1.25rem",
              borderRadius: "0.75rem",
              border: "1px solid rgba(245,158,11,0.4)",
              color: "#FFE4B5",
              fontSize: "0.875rem",
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              textDecoration: "none",
            }}
          >
            Back home
          </a>
        </div>

        {error.digest && (
          <p
            style={{
              marginTop: "1.5rem",
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.625rem",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            ref {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
