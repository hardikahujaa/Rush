"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ShoppingCart, X } from "lucide-react";

import type { Seat, Tier } from "@/lib/mock-data";
import { formatPaise } from "@/lib/mock-events";

export const MAX_SEATS = 4;

/**
 * The sticky cart.
 *
 * ── WHY IT IS ALWAYS PRESENT, NEVER MOUNTED ON FIRST SELECTION ─────────────
 * A bar that appears when the first seat is picked shoves the map up by its own
 * height at the exact moment the user is aiming at a 28px target - so their
 * second click lands on a different seat than the one under the cursor. It stays
 * mounted with a disabled button instead, and the page reserves matching bottom
 * padding, so nothing below the pointer ever moves.
 *
 * ── WHY THE LIMIT MESSAGE IS A LIVE REGION AND THE SHAKE IS NOT ────────────
 * Refusing a click is feedback that has to reach everyone. The shake is only
 * visible, so it is paired with a polite live region carrying the same fact in
 * words - and `polite` rather than `assertive` because the user is mid-task and
 * being interrupted would cost them their place in the map.
 */
export function CheckoutBar({
  selected,
  tiersById,
  onRemove,
  limitHit,
}: {
  selected: Seat[];
  tiersById: Map<string, Tier>;
  onRemove: (seat: Seat) => void;
  /** Increments each time a click was refused. Drives the shake. */
  limitHit: number;
}) {
  const reduceMotion = useReducedMotion();

  const total = selected.reduce(
    (sum, seat) => sum + (tiersById.get(seat.tierId)?.priceCents ?? 0),
    0,
  );

  return (
    <div
      data-checkout-bar
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-[#FACC15]/20 bg-black/80 backdrop-blur-xl"
      /* Respects the home-indicator strip on phones, where a checkout button
         flush to the bottom edge competes with the system gesture area. */
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <motion.div
        className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6"
        /* Keyed on the refusal count so each new refusal replays the shake,
           rather than the animation firing once and never again. */
        key={limitHit}
        animate={
          limitHit > 0 && !reduceMotion
            ? { x: [0, -9, 8, -6, 4, 0] }
            : undefined
        }
        transition={{ duration: 0.42, ease: "easeOut" }}
      >
        {/* ── left: what is in the cart ─────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Choose up to {MAX_SEATS} seats to continue
            </p>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {selected.length} of {MAX_SEATS} selected
              </p>
              {/* Chips wrap before they shrink: a seat label that has been
                  truncated to "Fro…" is worse than a second row. */}
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                <AnimatePresence initial={false}>
                  {selected.map((seat) => {
                    const tier = tiersById.get(seat.tierId);
                    return (
                      <motion.li
                        key={seat.id}
                        layout={!reduceMotion}
                        initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                        transition={{ type: "spring", stiffness: 480, damping: 30 }}
                      >
                        <button
                          type="button"
                          onClick={() => onRemove(seat)}
                          className="flex h-8 items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 pl-2.5 pr-2 text-[11px] font-medium text-gold-champagne outline-none transition-colors hover:bg-gold/20 focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Remove ${tier?.name} row ${seat.row} seat ${seat.number}`}
                        >
                          <span className="tabular-nums">
                            {tier?.name} · {seat.row}
                            {seat.number}
                          </span>
                          <X className="size-3 shrink-0 opacity-70" aria-hidden="true" />
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </>
          )}

          {/* The refusal, in words. Rendered empty until it happens so the
              region exists in the accessibility tree before it has content -
              a live region injected at the same moment as its text is often
              missed entirely by screen readers. */}
          <p role="status" aria-live="polite" className="sr-only">
            {limitHit > 0
              ? `Limit reached. You can select at most ${MAX_SEATS} seats. Remove one to choose another.`
              : ""}
          </p>
          {limitHit > 0 && (
            <p aria-hidden="true" className="mt-1.5 text-[11px] text-gold-champagne/90">
              Maximum {MAX_SEATS} seats per order — remove one to pick another.
            </p>
          )}
        </div>

        {/* ── right: total and the action ───────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
          <div className="text-left sm:text-right">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Total
            </p>
            <p className="text-xl font-semibold tabular-nums text-gold-champagne sm:text-2xl">
              {formatPaise(total)}
            </p>
          </div>

          <button
            type="button"
            disabled={selected.length === 0}
            className="btn-gold inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[15px] font-bold uppercase tracking-wide outline-none transition-[filter,box-shadow,opacity] duration-300 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
            style={
              selected.length > 0
                ? { boxShadow: "0 0 40px -12px rgba(250,204,21,0.9)" }
                : undefined
            }
          >
            <ShoppingCart className="size-4 shrink-0" aria-hidden="true" />
            Checkout
          </button>
        </div>
      </motion.div>
    </div>
  );
}
