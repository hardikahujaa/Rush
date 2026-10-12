import Link from "next/link";
import { SearchX } from "lucide-react";

import { PageTitle } from "@/components/layout/page-title";

/**
 * Shown when notFound() fires for an unknown event id.
 *
 * Scoped to this route segment rather than global, so the message can be about
 * events specifically instead of a generic 404 - and so it keeps the navbar and
 * the rest of the (site) chrome around it.
 */
export default function EventNotFound() {
  return (
    <main className="mx-auto flex min-h-[70svh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <SearchX className="size-10 text-muted-foreground" aria-hidden="true" />

      <PageTitle className="mt-6">That event is not here</PageTitle>

      <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
        The link may be mistyped, or the show may have been taken down by its
        organizer. Everything currently on sale is on the events page.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/events"
          className="btn-gold inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold"
        >
          Browse all events
        </Link>
        <Link
          href="/"
          className="btn-gold-outline inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-medium transition-colors"
        >
          Back home
        </Link>
      </div>
    </main>
  );
}
