"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Loader2,
  MapPin,
  Ticket,
} from "lucide-react";

import type { OrderView } from "@/db/queries/orders";
import { formatPaise } from "@/lib/mock-events";

/** Poll every 2s for at most 20s, per the T29 brief. */
const POLL_INTERVAL_MS = 2_000;
const POLL_LIMIT = 10;

type PollState = "confirming" | "confirmed" | "failed" | "timeout";

/**
 * The confirmed-order view.
 *
 * ── WHY THIS IS A CLIENT COMPONENT AND THE PAGE IS NOT ─────────────────────
 * The page itself is a server component: it reads the order from Postgres with
 * ownership enforced in SQL, so nothing sensitive is decided in the browser.
 * This component exists only for the three things that genuinely need the
 * client - the confetti, the poll, and the entrance motion - which is the
 * project's standing rule about pushing the `"use client"` boundary as far down
 * the tree as possible.
 */
export function SuccessView({ order }: { order: OrderView }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  /* The server already knows the answer if the webhook beat the redirect,
     which is the common case. Starting from that avoids a "confirming" flash
     on an order that was settled before this page was ever requested. */
  const [settled, setSettled] = useState<"confirming" | "confirmed" | "failed">(() =>
    order.status === "paid"
      ? "confirmed"
      : order.status === "failed" || order.status === "refunded"
        ? "failed"
        : "confirming",
  );
  const [attempts, setAttempts] = useState(0);

  /**
   * `timeout` is DERIVED, never stored.
   *
   * Storing it would mean an effect that watches the attempt count and calls
   * `setState("timeout")` - which trips React 19's `set-state-in-effect` rule
   * (it has fired twice before in this project) and costs a cascading render
   * for a value that is a pure function of state we already have. Giving up
   * after ten attempts IS `attempts >= POLL_LIMIT`; there is nothing to
   * remember separately, and nothing that can drift out of sync.
   */
  const state: PollState =
    settled !== "confirming"
      ? settled
      : attempts >= POLL_LIMIT
        ? "timeout"
        : "confirming";

  /* ── the poll ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    /* Covers settled AND timed-out: the derived value above is "confirming"
       only while there is genuinely another attempt left to make. */
    if (state !== "confirming") return;

    const id = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/orders/${order.orderId}/status`, {
          /* `no-store` is load-bearing. Without it the browser can serve the
             first response to every later poll, and the page would sit on
             "confirming" forever while the order was long since paid. */
          cache: "no-store",
        });
        if (!response.ok) {
          setAttempts((n) => n + 1);
          return;
        }
        const data = (await response.json()) as { status: string };

        if (data.status === "paid") {
          setSettled("confirmed");
          /* Re-render the server component so the seat list arrives with its
             real ticket ids rather than the nulls this page first loaded. */
          router.refresh();
        } else if (data.status === "failed" || data.status === "refunded") {
          setSettled("failed");
        } else {
          setAttempts((n) => n + 1);
        }
      } catch {
        setAttempts((n) => n + 1);
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearTimeout(id);
  }, [state, attempts, order.orderId, router]);

  /* ── the confetti ─────────────────────────────────────────────────────── */
  const burstFired = useRef(false);

  const fireConfetti = useCallback(async () => {
    if (burstFired.current || reduceMotion) return;
    burstFired.current = true;

    /**
     * Imported lazily, inside the handler.
     *
     * `canvas-confetti` is ~7kB that only ever runs on this one page, at one
     * moment, and never at all for a visitor who asked their OS for less
     * motion. A static import would put it in the bundle regardless, so it is
     * pulled in only once there is actually something to celebrate.
     */
    const { default: confetti } = await import("canvas-confetti");

    /* The brand palette, not confetti's defaults - champagne through amber, so
       the burst belongs to the same room as the rest of the page. */
    const colors = ["#FFE4B5", "#FACC15", "#F59E0B", "#FEF3C7"];

    /* Two offset bursts rather than one centred blast: a single origin reads as
       a graphic, two read as a room. */
    confetti({
      particleCount: 70,
      spread: 62,
      startVelocity: 46,
      origin: { x: 0.2, y: 0.72 },
      angle: 62,
      colors,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 70,
      spread: 62,
      startVelocity: 46,
      origin: { x: 0.8, y: 0.72 },
      angle: 118,
      colors,
      disableForReducedMotion: true,
    });
  }, [reduceMotion]);

  useEffect(() => {
    if (state === "confirmed") void fireConfetti();
  }, [state, fireConfetti]);

  const paid = state === "confirmed";

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      {/* ── the status crest ─────────────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center">
        <StatusCrest state={state} reduceMotion={Boolean(reduceMotion)} />

        {/* One polite live region for the whole status transition. The heading
            below changes text, and a screen reader needs to hear that once -
            not on every poll tick. */}
        <p role="status" aria-live="polite" className="sr-only">
          {paid
            ? `Payment confirmed. ${order.seats.length} ${
                order.seats.length === 1 ? "seat" : "seats"
              } booked for ${order.eventTitle}.`
            : state === "failed"
              ? "This payment did not complete."
              : state === "timeout"
                ? "Still confirming your payment."
                : "Confirming your payment."}
        </p>

        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="text-metal mt-6 text-balance text-3xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-4xl"
          aria-hidden="true"
        >
          {paid
            ? "You're going."
            : state === "failed"
              ? "This payment didn't complete"
              : state === "timeout"
                ? "Still confirming"
                : "Confirming your payment"}
        </motion.h1>

        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground"
        >
          {paid ? (
            <>
              Your seats are locked in and your tickets are issued. A QR code for
              each seat is on its way.
            </>
          ) : state === "failed" ? (
            <>
              No tickets were issued and your seats have gone back on sale. If you
              were charged, it will be refunded automatically.
            </>
          ) : state === "timeout" ? (
            <>
              Your payment went through — our confirmation is just running late.
              Your seats are safe. Refresh in a moment, or check your dashboard.
            </>
          ) : (
            <>
              Stripe has taken your payment and we&rsquo;re writing your tickets.
              This usually takes a second or two.
            </>
          )}
        </motion.p>
      </div>

      {/* ── the ticket stub ──────────────────────────────────────────────── */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.26, ease: [0.16, 1, 0.3, 1] }}
        className="glass relative mt-10 overflow-hidden rounded-2xl"
      >
        {/* Top edge carries the state, the way the hold banner's border does. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background: paid
              ? "linear-gradient(90deg, transparent, rgba(250,204,21,0.75) 50%, transparent)"
              : state === "failed"
                ? "linear-gradient(90deg, transparent, rgba(241,65,66,0.6) 50%, transparent)"
                : "linear-gradient(90deg, transparent, rgba(255,255,255,0.18) 50%, transparent)",
          }}
        />

        <div className="px-5 py-6 sm:px-7 sm:py-7">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {order.eventTitle}
          </p>

          <div className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-5">
            <p className="flex items-center gap-2">
              <CalendarDays className="size-4 shrink-0 text-gold" aria-hidden="true" />
              {new Intl.DateTimeFormat("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "long",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
                timeZone: "Asia/Kolkata",
              }).format(order.startsAt)}
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0 text-gold" aria-hidden="true" />
              {order.venueName}, {order.venueCity}
            </p>
          </div>

          <div className="rule-fade my-5 h-px" aria-hidden="true" />

          {/* ── seats ──────────────────────────────────────────────────── */}
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {order.seats.length} {order.seats.length === 1 ? "seat" : "seats"}
          </p>

          <ul className="mt-3 flex flex-col gap-2">
            {order.seats.map((seat, index) => (
              <motion.li
                key={seat.seatId}
                initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: 0.4,
                  /* Staggered so the seats read as a list being issued one by
                     one, rather than a block appearing. */
                  delay: 0.34 + index * 0.07,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Ticket className="size-4 shrink-0 text-gold/70" aria-hidden="true" />
                  <span className="truncate text-sm tabular-nums text-foreground">
                    {seat.sectionName} · Row {seat.rowLabel} · Seat {seat.seatNo}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {formatPaise(seat.priceCents)}
                </span>
              </motion.li>
            ))}
          </ul>

          {order.seats.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Your seats appear here the moment confirmation lands.
            </p>
          )}

          <div className="rule-fade my-5 h-px" aria-hidden="true" />

          {/* ── total ──────────────────────────────────────────────────── */}
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {paid ? "Total paid" : "Total"}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-gold-champagne sm:text-3xl">
                {formatPaise(order.totalCents)}
              </p>
            </div>
            <p className="text-right text-[10px] leading-relaxed text-muted-foreground">
              Order
              <br />
              {/* Shown in full so it can be quoted to support, and selectable
                  rather than truncated behind an ellipsis. */}
              <span className="select-all font-mono text-[10px] text-foreground/70">
                {order.orderId.slice(0, 8)}
              </span>
            </p>
          </div>
        </div>
      </motion.div>

      {/* ── actions ──────────────────────────────────────────────────────── */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.46, ease: [0.16, 1, 0.3, 1] }}
        className="mt-7 flex flex-col gap-3 sm:flex-row"
      >
        <Link
          href="/dashboard"
          className="btn-gold inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-bold uppercase tracking-wide outline-none transition-[filter] duration-300 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          View your orders
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </Link>
        <Link
          href={`/events/${order.eventId}`}
          className="btn-gold-outline inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to event
        </Link>
      </motion.div>

      {state === "timeout" && (
        <button
          type="button"
          onClick={() => {
            setAttempts(0);
            router.refresh();
          }}
          className="mx-auto mt-5 block text-xs text-gold-champagne underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Check again
        </button>
      )}

      {/* Scannable QR codes are T30. Said plainly rather than shipping a button
          that 404s - the same call T24 and T25 made about their own forward
          references. */}
      <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
        Scannable QR tickets arrive in the next build step.
      </p>
    </div>
  );
}

/* ── the crest ────────────────────────────────────────────────────────────── */

/**
 * The circular status mark above the heading.
 *
 * The confirmed state draws its tick with an SVG `pathLength` animation rather
 * than fading in a finished glyph - a mark being *drawn* reads as something
 * just completed, which is exactly the moment this page exists to represent.
 * `pathLength` is used instead of hand-computed `stroke-dasharray` values
 * because it normalises the path to 0..1, so the animation does not have to
 * know how long the path actually is.
 */
function StatusCrest({
  state,
  reduceMotion,
}: {
  state: PollState;
  reduceMotion: boolean;
}) {
  const confirmed = state === "confirmed";
  const failed = state === "failed";

  return (
    <div className="relative grid size-20 place-items-center">
      {/* The halo. Scales out once, on arrival. */}
      {confirmed && !reduceMotion && (
        <motion.span
          aria-hidden="true"
          initial={{ opacity: 0.55, scale: 0.6 }}
          animate={{ opacity: 0, scale: 1.9 }}
          transition={{ duration: 1.1, ease: "easeOut" }}
          className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(250,204,21,0.5), transparent 70%)" }}
        />
      )}

      <motion.div
        initial={reduceMotion ? false : { scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 22 }}
        className="relative grid size-20 place-items-center rounded-full border"
        style={{
          borderColor: confirmed
            ? "rgba(250,204,21,0.5)"
            : failed
              ? "rgba(241,65,66,0.5)"
              : "rgba(255,255,255,0.14)",
          background: confirmed
            ? "radial-gradient(circle at 50% 35%, rgba(250,204,21,0.17), transparent 70%)"
            : "rgba(255,255,255,0.03)",
          boxShadow: confirmed ? "0 0 44px -14px rgba(250,204,21,0.85)" : undefined,
        }}
      >
        <AnimatePresence mode="wait">
          {confirmed ? (
            <motion.svg
              key="tick"
              viewBox="0 0 24 24"
              fill="none"
              className="size-9"
              aria-hidden="true"
            >
              <motion.path
                d="M4.5 12.4l4.7 4.7L19.6 6.7"
                stroke="#FFE4B5"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduceMotion ? { pathLength: 1 } : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: 0.12, ease: "easeOut" }}
              />
            </motion.svg>
          ) : failed ? (
            <motion.span key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
            </motion.span>
          ) : (
            <motion.span key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Loader2
                className={`size-8 text-gold/80 ${reduceMotion ? "" : "animate-spin"}`}
                aria-hidden="true"
              />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
