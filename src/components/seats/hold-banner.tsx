"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "framer-motion";
import { ArrowRight, CheckCircle2, Clock, Loader2 } from "lucide-react";

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
  onExpire,
  onRelease,
  releasing,
  onCheckout,
  checkoutPending,
  checkoutError,
  checkoutCoolingDown,
}: {
  seats: HeldSeatView[];
  expiresAtIso: string;
  totalCents: number;
  eventId: string;
  /** True when the hold already existed - a retry, not a fresh claim. */
  replayed: boolean;
  /** Fired ONCE when the countdown reaches zero. */
  onExpire: () => void;
  /** Hands these seats back. Resolves false if the server refused. */
  onRelease: () => Promise<boolean>;
  /** A release request is in flight. */
  releasing: boolean;
  /** Claim these seats on Stripe and navigate to the hosted checkout page. */
  onCheckout: () => void;
  /** A checkout request is in flight. The button must not fire twice. */
  checkoutPending: boolean;
  /** Server-supplied failure text, already human-readable. */
  checkoutError: string | null;
  /** A 429 cooldown is running - the button stays disabled until it clears. */
  checkoutCoolingDown: boolean;
}) {
  const reduceMotion = useReducedMotion();
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
  /* Two minutes out the bar turns urgent. Colour is never the only signal:
     the label changes to "Expiring soon" and the digits themselves are the
     information, always present at full contrast. */
  const urgent = remainingMs !== null && remainingMs < 120_000 && !expired;

  /**
   * The zero trigger, fired exactly once.
   *
   * The ref is what makes it once. `expired` stays true for every subsequent
   * tick, so calling the parent from render - or from an unguarded effect -
   * would fire a router.refresh() four times a second forever.
   *
   * It runs in an effect rather than during render because it reaches outside
   * this component: React may render speculatively, and a speculative render
   * must not empty someone's cart.
   */
  /**
   * Two-step confirm, because this is irreversible at the worst moment.
   *
   * "Release seats" sits inches from "Proceed to Payment" while a clock is
   * running. A stray click there does not cost a mis-navigation - it hands four
   * seats back into a live drop, where they can be gone before the user
   * understands what happened.
   *
   * The first click arms it for four seconds and it disarms itself. No modal:
   * a dialog stealing focus over a running countdown is its own kind of hostile.
   */
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const firedRef = useRef(false);
  useEffect(() => {
    if (expired && !firedRef.current) {
      firedRef.current = true;
      onExpire();
    }
  }, [expired, onExpire]);

  return (
    <div
      data-checkout-bar
      className="fixed inset-x-0 bottom-0 z-[100] border-t bg-black/85 backdrop-blur-xl"
      style={{
        /* The bar's own edge carries the state, so the signal is visible even
           to someone not looking directly at the digits. */
        borderTopColor: expired
          ? "rgba(255,255,255,0.12)"
          : urgent
            ? "rgba(241,65,66,0.55)"
            : "rgba(250,204,21,0.35)",
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

          {/* Same convention as CheckoutBar's error surface: a live region that
              exists before it has content, and gold-champagne rather than
              text-destructive - that colour is reserved for the countdown
              running out, not for "checkout failed", which is a different
              signal. */}
          <p role="status" aria-live="polite" className="sr-only">
            {checkoutError ?? ""}
          </p>
          {checkoutError && (
            <p className="mt-1.5 text-[11px] font-medium text-gold-champagne">
              {checkoutError}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
          {!expired && (
            <div className="text-left sm:text-right">
              <p
                className={`text-[10px] uppercase tracking-[0.18em] ${
                  urgent ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {urgent ? "Expiring soon" : "Time left"}
              </p>

              <span className="flex items-center gap-2 sm:justify-end">
                {/* THE PULSE LIVES HERE, NOT ON THE DIGITS.
                    `animate-pulse` fades its target to 50% opacity. Measured on
                    this page, that takes the red timer from 5.57:1 down to
                    2.04:1 - under even the 3:1 large-text floor - for half of
                    every cycle, at the exact moment the number matters most.
                    A dot carries no information, so it can blink freely. */}
                {urgent && (
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-full bg-destructive ${
                      reduceMotion ? "" : "animate-pulse"
                    }`}
                  />
                )}
                <span
                  aria-hidden="true"
                  className={`text-xl font-semibold tabular-nums sm:text-2xl ${
                    urgent ? "text-destructive" : "text-gold-champagne"
                  }`}
                >
                  {remainingMs === null ? "--:--" : `${mm}:${ss}`}
                </span>
              </span>

              {/* The same fact, once, in a form worth announcing. A screen
                  reader hearing a number change every second would be unusable. */}
              <p className="sr-only">
                {remainingMs === null
                  ? ""
                  : totalSeconds < 120
                    ? `Expiring soon: under ${Math.ceil(totalSeconds / 60)} minute left to pay.`
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
            <span className="flex items-start gap-2">
              {/* Secondary by weight, not by size: outline instead of filled,
                  so the eye lands on payment first - but still a full-height
                  target, because a cramped escape hatch is its own problem. */}
              <button
                type="button"
                onClick={async () => {
                  if (!armed) {
                    setArmed(true);
                    return;
                  }
                  setArmed(false);
                  await onRelease();
                }}
                disabled={releasing || checkoutPending}
                aria-label={
                  armed
                    ? "Confirm releasing your seats"
                    : "Release your seats and return them to sale"
                }
                className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 ${
                  armed
                    ? "border border-destructive/60 bg-destructive/12 text-destructive"
                    : "btn-gold-outline"
                }`}
              >
                {releasing ? (
                  <>
                    <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                    Releasing
                  </>
                ) : armed ? (
                  "Tap again to release"
                ) : (
                  "Release seats"
                )}
              </button>

              <button
                type="button"
                onClick={onCheckout}
                /* Disabled while a request is in flight so a double-click
                   cannot open two Stripe sessions for the same hold, while a
                   429 cooldown is running, and while a release is in flight -
                   releasing and paying for the same seats at once makes no
                   sense to allow. */
                disabled={checkoutPending || checkoutCoolingDown || releasing}
                aria-busy={checkoutPending}
                className="btn-gold inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-bold uppercase tracking-wide outline-none transition-[filter,opacity] duration-300 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100"
              >
                {checkoutPending ? (
                  <>
                    <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                    Opening checkout
                  </>
                ) : (
                  <>
                    Proceed to Payment
                    <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                  </>
                )}
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
