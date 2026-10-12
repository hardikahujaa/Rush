import Link from "next/link";
import { Compass } from "lucide-react";

/**
 * T41 — the catch-all for a URL that matches NOTHING, as opposed to
 * `(site)/events/[id]/not-found.tsx`, which handles a known segment
 * (`/events/[id]`) whose specific id does not exist.
 *
 * ── WHY THIS HAS NO NAVBAR, AND CANNOT BORROW `(site)/layout.tsx`'s ────────
 * A root `app/not-found.tsx` is rendered when no route segment matches at
 * all - there is no matched layout tree to nest into, so Next renders this
 * directly inside the bare root `app/layout.tsx` (`<html><body>`, nothing
 * else) regardless of which route group the mistyped URL was aiming for.
 * `events/[id]/not-found.tsx` is a genuinely different case: `/events/[id]`
 * DID match as a segment, only the specific event did not exist, so Next
 * still renders `(site)/layout.tsx` around it. This file has to be a
 * complete, self-contained page rather than assume the chrome other pages
 * get for free.
 *
 * The root layout's `<body>` already paints `--background` (pure black), so
 * this needs no background of its own - only centred content on top of it.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <Compass className="size-10 text-muted-foreground" aria-hidden="true" />

      <h1 className="text-metal mt-6 text-balance text-3xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-4xl">
        Nothing&rsquo;s here
      </h1>

      <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
        The page you were looking for doesn&rsquo;t exist, or the link may be
        mistyped.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/"
          className="btn-gold inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold"
        >
          Back home
        </Link>
        <Link
          href="/events"
          className="btn-gold-outline inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-medium transition-colors"
        >
          Browse all events
        </Link>
      </div>
    </main>
  );
}
