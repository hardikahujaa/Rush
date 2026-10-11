"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Armchair } from "lucide-react";

import { formatPaise } from "@/lib/format";

export type RecentOrderRow = {
  orderId: string;
  buyerEmail: string;
  seatCount: number;
  totalCents: number;
  createdAt: string;
};

/** Seconds between polls. A sales dashboard, not a drop lobby - nothing here
 *  needs T34's adaptive cadence. */
const POLL_MS = 15_000;

function timeAgo(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * The live order feed.
 *
 * ── POLLING, NOT SUPABASE REALTIME ─────────────────────────────────────────
 * See the long note on `getRecentOrders` in `analytics.ts` for why: `orders`
 * is deliberately absent from T33's realtime publication, because its rows
 * carry a buyer's identity and a sum of money. This polls
 * `GET /api/organizer/events/[id]/recent-orders` on a plain interval instead -
 * the same data, pulled rather than pushed, with no change to what Postgres
 * exposes over a public socket.
 *
 * ── NEW ROWS ANIMATE IN; EXISTING ROWS DO NOT RE-ANIMATE ───────────────────
 * `AnimatePresence` is keyed on `orderId`, so a row already on screen when a
 * poll returns is the SAME element to React and is left alone - only a
 * genuinely new order enters with the full appear animation. Without the key,
 * every poll would replay the drop-in for the whole list, which reads as the
 * panel flickering every fifteen seconds rather than new sales arriving.
 */
export function RecentOrders({ eventId }: { eventId: string }) {
  const reduceMotion = useReducedMotion();
  const [rows, setRows] = useState<RecentOrderRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(
          `/api/organizer/events/${eventId}/recent-orders?limit=10`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { orders: RecentOrderRow[] };
        if (!cancelled) setRows(data.orders);
      } catch {
        /* A dashboard panel failing to refresh is not an incident - the last
           good list stays on screen and the next poll tries again. */
      }
    }

    void poll();
    const interval = setInterval(poll, POLL_MS);
    /* Re-render once a minute so "3m ago" keeps advancing without a second
       polling loop - this is display-only and makes no network request. */
    const clock = setInterval(() => setNow(Date.now()), 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(clock);
    };
  }, [eventId]);

  if (rows === null) {
    return <p className="py-8 text-center text-xs text-muted-foreground">Loading recent orders…</p>;
  }

  if (rows.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">No orders yet.</p>;
  }

  return (
    <ul className="divide-y divide-white/[0.06]">
      <AnimatePresence initial={false}>
        {rows.map((order) => (
          <motion.li
            key={order.orderId}
            layout={!reduceMotion}
            initial={reduceMotion ? false : { opacity: 0, y: -8, backgroundColor: "rgba(245,158,11,0.12)" }}
            animate={{ opacity: 1, y: 0, backgroundColor: "rgba(245,158,11,0)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex items-center justify-between gap-3 px-1 py-3"
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
                <Armchair className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{order.buyerEmail}</p>
                <p className="text-xs text-muted-foreground">
                  {order.seatCount} {order.seatCount === 1 ? "seat" : "seats"} ·{" "}
                  {timeAgo(order.createdAt, now)}
                </p>
              </div>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-gold-champagne">
              {formatPaise(order.totalCents)}
            </p>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
