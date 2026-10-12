"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The shared shape behind every `error.tsx` T41 adds.
 *
 * ── THE PATTERN THIS FOLLOWS ALREADY EXISTED ───────────────────────────────
 * `events/[id]/seats/error.tsx` built this card first - icon, a clear
 * statement of what broke, reassurance about what did NOT happen, a retry
 * button wired to `reset`, and a selectable digest for a bug report. T41
 * extracts that shape so eleven more segments share it instead of
 * reinventing it, with only the icon and the two lines of copy varying per
 * page - the one thing that genuinely differs between "the seat map didn't
 * load" and "your tickets didn't load" is what to say, not how to say it.
 *
 * ── `error.tsx` MUST BE A CLIENT COMPONENT ─────────────────────────────────
 * It receives the thrown `error` object and the `reset` callback from Next,
 * neither of which a Server Component can be handed. `reset` re-renders the
 * segment in place rather than reloading the document - the one thing this
 * component exists to offer a way back to.
 *
 * ── THE DIGEST, NOT THE MESSAGE ────────────────────────────────────────────
 * In production Next redacts `error.message` for anything thrown on the
 * server and leaves only `error.digest` - a short id that correlates this
 * exact failure to the server log (and, from T45 on, to Sentry). Showing it
 * is what turns "it's broken" into a traceable report; it is never the raw
 * error text, which could leak implementation detail to an attacker on a
 * page that is reachable while signed out.
 */
export function ErrorState({
  error,
  reset,
  icon: Icon = AlertTriangle,
  title,
  description,
  backHref = "/",
  backLabel = "Back home",
  bare = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  icon?: LucideIcon;
  title: string;
  description: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Skip the glass card - for a segment (like `(auth)`) whose own layout
   *  already draws one, where this component's own card would double-box. */
  bare?: boolean;
}) {
  return (
    <div
      className={
        bare
          ? "text-center"
          : "glass mx-auto max-w-lg rounded-2xl px-6 py-12 text-center"
      }
    >
      <Icon className="mx-auto size-7 text-destructive" aria-hidden="true" />

      <h1 className="text-metal mt-5 text-2xl font-bold tracking-[-0.03em]">
        {title}
      </h1>

      <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
        {description}
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
          href={backHref}
          className="btn-gold-outline inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {backLabel}
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-[10px] text-muted-foreground">
          ref <span className="select-all">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
