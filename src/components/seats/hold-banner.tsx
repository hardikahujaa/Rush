"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { CheckCircle2, Clock } from "lucide-react";

import { formatPaise } from "@/lib/mock-events";

export type HeldSeatView = {
  holdId: string;
  seatId: string;
  sectionName: string;
  rowLabel: string;
  seatNo: number;
  priceCents: number;
};

/**
 * A one-second clock, as an external store.
 *
 * The same shape as the countdown in `events/event-cta.tsx` and for the same
 * reasons: `useState` + `setInterval` inside an effect trips React 19's
 * `set-state-in-effect` rule, and the server snapshot has to be a fixed value or
 * SSR renders a time that is already wrong by the time it hydrates.
 *
 * `getSnapshot` MUST be cached, or React re-renders forever chasing a number
 * that changed while it was looking at it - hence the second-resolution cache.
 *
 * (The two clocks are deliberately not shared yet. T24 builds the real hold
 * countdown UI and is the right moment to unify them, rather than refactoring
 * verified T18 code as a side effect of T20.)
 */
let cachedSecond = -1;

function getClientSnapshot() {
  const second = Math.floor(Date.now() / 1000);
  if (second !== cachedSecond) cachedSecond = second;
  return cachedSecond;
}

const getServerSnapshot = () => 0;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 250);
  return () => clearInterval(id);
}

/**
 * The confirmation bar shown once seats are actually reserved.
 *
 * Replaces the checkout bar rather than stacking above it: the user has left the
 * "choosing" task and entered the "pay before this runs out" one, and showing
 * both would suggest they can still be doing the first.
 */
export function HoldBanner({
  seats,
  expiresAtIso,
  totalCents,
  eventId,
  replayed,
}: {
  seats: HeldSeatView[];
  expiresAtIso: string;
  totalCents: number;
  eventId: string;
  /** True when the hold already existed - a retry, not a fresh claim. */
  replayed: boolean;
}) {
  const nowSeconds = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const expiresAt = new Date(expiresAtIso).getTime();
  const remainingMs = nowSeconds === 0 ? null : Math.max(0, expiresAt - nowSeconds * 1000);
  const expired = remainingMs !== null && remainingMs === 0;

  const totalSeconds = Math.floor((remainingMs ?? 0) / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  /* Under a minute the bar turns urgent. Colour is not the only signal - the
     digits themselves are the information, and they are always present. */
  const urgent = remainingMs !== null && remainingMs < 60_000 && !expired;

  return (
    <div
      data-checkout-bar
      className="fixed inset-x-0 bottom-0 z-[100] border-t bg-black/85 backdrop-blur-xl"
      style={{
        borderTopColor: expired
          ? "rgba(255,255,255,0.12)"
          : "rgba(74,222,128,0.35)",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <div className="min-w-0 flex-1">
          {/* Announced once, politely. The countdown below is aria-hidden - a
              screen reader reading a number that changes every second would
              talk over everything else on the page. */}
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium">
            {expired ? (
              <>
                <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">
                  Your hold expired — those seats are back on sale.
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4 shrink-0 text-live" aria-hidden="true" />
                <span>
                  {seats.length} {seats.length === 1 ? "seat" : "seats"} secured
                  {replayed && " (already held by you)"}
                </span>
              </>
            )}
          </p>

          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {seats.map((seat) => (
              <li
                key={seat.holdId}
                className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-[11px] tabular-nums text-muted-foreground"
              >
                {seat.sectionName} · {seat.rowLabel}
                {seat.seatNo}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
          {!expired && (
            <div className="text-left sm:text-right">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Time left
              </p>
              <p
                aria-hidden="true"
                className={`text-xl font-semibold tabular-nums sm:text-2xl ${
                  urgent ? "text-gold-champagne" : "text-live"
                }`}
              >
                {remainingMs === null ? "--:--" : `${mm}:${ss}`}
              </p>
              {/* The same fact, once, in a form worth announcing. */}
              <p className="sr-only">
                {remainingMs === null
                  ? ""
                  : `About ${Math.ceil(totalSeconds / 60)} minutes left to pay.`}
              </p>
            </div>
          )}

          <div className="text-left sm:text-right">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Total
            </p>
            <p className="text-xl font-semibold tabular-nums text-gold-champagne sm:text-2xl">
              {formatPaise(totalCents)}
            </p>
          </div>

          {expired ? (
            <Link
              href={`/events/${eventId}/seats`}
              className="btn-gold-outline inline-flex h-12 items-center rounded-xl px-6 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Choose again
            </Link>
          ) : (
            /* Deliberately inert. Payment is T25-T27; a button that looked
               ready and did nothing would be worse than one that says where
               the flow currently ends. */
            <button
              type="button"
              disabled
              title="Payment arrives in T25"
              className="btn-gold inline-flex h-12 cursor-not-allowed items-center gap-2 rounded-xl px-6 text-[15px] font-bold uppercase tracking-wide opacity-45"
            >
              Pay now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
