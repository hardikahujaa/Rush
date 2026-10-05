"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

import { CheckoutBar, MAX_SEATS } from "@/components/seats/checkout-bar";
import { HoldBanner, type HeldSeatView } from "@/components/seats/hold-banner";
import { SeatButton, keepClearOfCart } from "@/components/seats/seat-button";
import { TierLegend } from "@/components/seats/tier-legend";
import { useSeatRealtime, type SeatChange } from "@/components/seats/use-seat-realtime";
import { useSecondTick } from "@/components/seats/use-second-tick";
import { FocalEdge, VenueFrame } from "@/components/seats/venue-frame";
import type { Seat, SeatStatus, TierWithStats, VenueType } from "@/lib/mock-data";
import { formatPaise } from "@/lib/format";

/** The 200 body from POST /api/holds. */
type HoldSuccess = {
  eventId: string;
  seats: HeldSeatView[];
  expiresAt: string;
  totalCents: number;
  replayed: boolean;
};

/** Seats grouped into their rows, in front-to-back reading order. */
type Row = { key: string; label: string; seats: Seat[] };

function groupRows(tierId: string, seats: Seat[]): Row[] {
  const byRow = new Map<string, Seat[]>();
  for (const seat of seats) {
    if (seat.tierId !== tierId) continue;
    const bucket = byRow.get(seat.row);
    if (bucket) bucket.push(seat);
    else byRow.set(seat.row, [seat]);
  }
  return [...byRow.entries()].map(([label, rowSeats]) => ({
    key: `${tierId}-${label}`,
    label,
    seats: rowSeats,
  }));
}

/**
 * The interactive venue.
 *
 * ── WHY THE SEATS ARRIVE AS A PROP ─────────────────────────────────────────
 * The grid is built on the server and passed down. The client never generates
 * it, because a second generation would be a second source of truth - and the
 * one thing this task is about is that there is exactly one.
 *
 * ── WHY SELECTION IS AN ARRAY AND NOT A Set ────────────────────────────────
 * Order matters in the cart: seats appear in the sequence they were picked, so
 * removing the third chip removes the seat the user picked third. A Set has no
 * order to rely on.
 */
export function SeatMap({
  eventId,
  venueType,
  tiers,
  seats,
  canHold,
  initialHold,
}: {
  eventId: string;
  venueType: VenueType;
  tiers: TierWithStats[];
  seats: Seat[];
  /** False for mock events, whose seat ids exist nowhere in the database. */
  canHold: boolean;
  /**
   * The caller's live hold, read from Postgres by the server component.
   *
   * This is what makes the countdown survive a refresh. Without it the timer
   * lived only in the state below, so one F5 wiped it while the database went
   * on holding the seats for another nine minutes - and the buyer, seeing
   * nothing, would reasonably assume the hold was gone.
   */
  initialHold: HoldSuccess | null;
}) {
  const router = useRouter();

  /**
   * Selection is stored as IDS, not as Seat objects.
   *
   * After a conflict the page calls router.refresh(), the `seats` prop arrives
   * with new statuses, and any Seat object captured in state is now a stale
   * snapshot claiming "available" about a seat somebody else just bought.
   * Holding ids and re-reading them from the current prop makes that
   * impossible: the selection is always described by the freshest data.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /* A counter, not a boolean: re-keying the shake on each refusal is what makes
     the second rejected click animate as well as the first. */
  const [limitHit, setLimitHit] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<HoldSuccess | null>(initialHold);
  /* Seats this browser holds. Rendered distinctly so they are not mistaken for
     a stranger's amber hold on the refreshed map. */
  /* Seeded from the restored hold too, so after a refresh the user's seats
     still render as THEIRS (gold) rather than as a stranger's amber hold. */
  const [mine, setMine] = useState<Set<string>>(
    () => new Set(initialHold?.seats.map((s) => s.seatId) ?? []),
  );
  /* Unix ms until which the Hold button stays disabled after a 429. Zero means
     no cooldown is running. */
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [releasing, setReleasing] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  /* Unix ms until which the Pay button stays disabled after a 429. Mirrors
     `cooldownUntil` above but on its own clock, since a checkout flood and a
     hold flood are rate-limited on separate Redis budgets. */
  const [checkoutCooldownUntil, setCheckoutCooldownUntil] = useState(0);
  /**
   * Seats the server has confirmed released, whose `seats` prop has not caught
   * up yet.
   *
   * Without this there is a visible lie. After a release the prop still says
   * `status: 'held'` until router.refresh() lands, and with `mine` cleared
   * SeatButton would paint those seats amber and pulsing - "on hold,
   * unavailable" - so for a few hundred milliseconds the user's own seats look
   * like a stranger just took them.
   *
   * This is NOT optimism about the outcome: it is only ever populated after a
   * 200, so the seat genuinely is free and only our props are stale. It clears
   * itself when the refreshed prop arrives.
   */
  const [justReleased, setJustReleased] = useState<Set<string>>(new Set());

  /**
   * Statuses pushed by Realtime since the last time fresh props arrived (T33).
   *
   * Kept in a Map rather than merged into a copy of `seats`, for the same
   * reason `justReleased` is: a second copy of the seat list is a second thing
   * that can disagree with the server. This is an OVERLAY, applied during
   * render and discarded the moment real data lands.
   */
  const [liveStatus, setLiveStatus] = useState<Map<string, SeatStatus>>(new Map());

  /**
   * Drop the override the moment real data arrives.
   *
   * Without this the override outlives its purpose: hold one of those seats
   * again later and the prop would correctly say 'held' while we kept forcing
   * 'available' - a stale lie replacing the brief one it was added to prevent.
   *
   * Setting state during render is React's documented way to adjust state when
   * a prop changes; React discards the in-progress render and immediately redoes
   * it, without committing the first pass or touching the DOM. Doing it in an
   * effect instead would paint one frame with the wrong seats first, and is what
   * React 19's set-state-in-effect rule exists to discourage.
   */
  const [seatsSeen, setSeatsSeen] = useState(seats);
  if (seats !== seatsSeen) {
    setSeatsSeen(seats);
    if (justReleased.size > 0) setJustReleased(new Set());
    /**
     * Realtime overrides are dropped wholesale, not reconciled one by one.
     *
     * The alternative - keeping any override the new props disagree with - is
     * tempting and wrong. An override only knows a status, never WHY: an event
     * saying "held" cannot tell that the hold has since expired, so a kept
     * override can outlive the fact it described and show a held seat that is
     * genuinely free. That is precisely the stale lie the `justReleased` note
     * above warns about.
     *
     * Dropping them is safe because the refresh that produced these props was
     * SCHEDULED BY those same events, so it necessarily reflects them. The
     * server is the source of truth; an overlay is only ever a guess about the
     * gap between two reads of it.
     */
    if (liveStatus.size > 0) setLiveStatus(new Map());
  }
  const reduceMotion = useReducedMotion();

  /* ── LIVE UPDATES ──────────────────────────────────────────────────────── */

  const tick = useSecondTick();

  /**
   * Reconciliation, debounced AND jittered.
   *
   * Realtime paints instantly but can only carry a seat's status. Three things
   * it cannot carry need a real refetch:
   *
   *   - the new hold's `expires_at`, which the `seats` row does not contain and
   *     which the local-expiry rule below needs
   *   - the per-tier counts in the legend, and the standing zones' remaining
   *     admissions
   *   - the page header's "N of M seats available" and its sold-out banner,
   *     which live in a SERVER component and cannot be reached from here at all
   *
   * ── WHY THE JITTER IS NOT DECORATION ──────────────────────────────────────
   * Every client watching this event receives the same burst within
   * milliseconds of each other. A bare `router.refresh()` would have all of
   * them re-request the page inside the same instant - so the app would answer
   * a popular drop by pointing a synchronised stampede at itself, at precisely
   * the moment it is least able to absorb one. A random delay spreads that
   * stampede into a trickle.
   *
   * Coalescing matters as much: forty seats changing in one second must cost
   * ONE refresh, not forty.
   */
  const refreshTimer = useRef<number | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return; // already pending - coalesce
    const delay = 1200 + Math.random() * 1800; // 1.2-3.0s, spread per client
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, delay);
  }, [router]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  const handleSeatChange = useCallback((change: SeatChange) => {
    setLiveStatus((current) => {
      if (current.get(change.id) === change.status) return current; // no-op
      const next = new Map(current);
      next.set(change.id, change.status);
      return next;
    });
    scheduleRefresh();
  }, [scheduleRefresh]);

  /**
   * EVERY subscribe resyncs, including the first — and that is a correction.
   *
   * The first version of this skipped the first `SUBSCRIBED` on the reasonable
   * grounds that the props were seconds old already, so refreshing would make
   * every page load re-request itself for nothing.
   *
   * MEASURED, and it was wrong. Supabase reports `SUBSCRIBED` *before* the
   * server-side change feed is actually armed for the filter. In
   * `scripts/realtime-test.ts` a hold committed immediately after that callback
   * was never delivered, while the very next write on the same channel arrived
   * in 484ms; inserting a 2.5s settle made the same hold arrive in 1049ms.
   *
   * So there is a window of roughly a second or two after subscribing in which
   * a change is silently lost. A change lost there is the worst possible kind:
   * it produces no event, so it also produces no resync, and the map stays
   * wrong with nothing left to correct it.
   *
   * Resyncing on the first subscribe closes that window - and because the
   * refresh is already debounced into the 1.2-3.0s band, it lands right where
   * the warm-up ends. One cheap RSC re-render per page load buys a seat map
   * that cannot start out stale.
   */
  const handleResync = useCallback(() => {
    scheduleRefresh();
  }, [scheduleRefresh]);

  const realtime = useSeatRealtime({
    eventId,
    /* Mock events have seat ids that exist nowhere in Postgres, so there is
       nothing to subscribe to and nothing would ever arrive. */
    enabled: canHold,
    onChange: handleSeatChange,
    onResync: handleResync,
  });

  const tiersById = useMemo(
    () => new Map(tiers.map((tier) => [tier.id, tier])),
    [tiers],
  );

  /**
   * The seat list as the user should see it right now.
   *
   * Anything in `justReleased` is forced to `available`, overriding a prop that
   * has not been refetched yet. Derived during render rather than copied into
   * state, so when the server does send fresh data the override simply stops
   * mattering - there is no second copy to remember to clear.
   */
  const visibleSeats = useMemo(() => {
    const nothingToApply =
      justReleased.size === 0 && liveStatus.size === 0 && tick === 0;
    if (nothingToApply) return seats;

    const nowMs = tick * 1000;

    return seats.map((seat) => {
      /* 1. Realtime first: newer than the prop by construction, because the
            overlay is cleared every time props change. */
      let status = liveStatus.get(seat.id) ?? seat.status;

      /**
       * 2. LOCAL EXPIRY - the transition Realtime can never deliver.
       *
       * A hold running out writes no row (T22), so Postgres emits no change and
       * the socket stays silent. Without this, a seat freed by expiry would
       * stay amber in every other browser until the 03:00 cron happened to run.
       *
       * So the client applies the same rule the database applies - `expires_at`
       * in the past means not held - which is T22's read-time decision, made at
       * render time. `tick === 0` means pre-hydration, where the server's own
       * status is the only honest answer.
       *
       * Only ever relaxes a seat from held to available; it can never invent a
       * hold or override a sale.
       */
      if (
        status === "held" &&
        tick > 0 &&
        seat.holdExpiresAt &&
        new Date(seat.holdExpiresAt).getTime() <= nowMs
      ) {
        status = "available";
      }

      /* 3. A release this browser performed and the server has confirmed. Last
            because it is the one thing we know first-hand. */
      if (justReleased.has(seat.id)) status = "available";

      return status === seat.status ? seat : { ...seat, status };
    });
  }, [seats, justReleased, liveStatus, tick]);

  const seatsById = useMemo(
    () => new Map(visibleSeats.map((seat) => [seat.id, seat])),
    [visibleSeats],
  );

  /**
   * Tier counts, recomputed from the LIVE seat list.
   *
   * ── WHY THE SERVER'S COUNTS CANNOT BE USED ONCE SEATS MOVE ────────────────
   * `tiers` arrives with `stats` computed by `getSeatMapForEvent` at request
   * time. The instant Realtime changes a seat, those numbers describe a room
   * that no longer exists - so the legend would say "12 left" over a grid
   * showing eleven, and a standing zone would stay enabled on its last
   * admission after somebody else took it.
   *
   * That failure has a history here. T22 found `getSeatMapForEvent` running two
   * queries whose availability rules had drifted, and fixed it by making the
   * counts a REDUCTION of the seat list rather than a second computation - so
   * disagreement became unrepresentable rather than merely absent. Reducing the
   * live list here is the same fix applied to the same risk, one layer out: the
   * counts are the seats, so they cannot contradict them.
   *
   * Standing tiers have no per-seat buttons, but `mock-data.ts` still generates
   * one seat row per admission, so the same reduction covers them.
   */
  const liveTiers = useMemo<TierWithStats[]>(() => {
    const counts = new Map<string, { total: number; available: number; held: number; sold: number }>();
    for (const tier of tiers) {
      counts.set(tier.id, { total: 0, available: 0, held: 0, sold: 0 });
    }
    for (const seat of visibleSeats) {
      const bucket = counts.get(seat.tierId);
      if (!bucket) continue;
      bucket.total++;
      bucket[seat.status]++;
    }
    return tiers.map((tier) => ({
      ...tier,
      stats: counts.get(tier.id) ?? tier.stats,
    }));
  }, [tiers, visibleSeats]);

  /**
   * RECONCILED DURING RENDER, NOT IN AN EFFECT.
   *
   * When refreshed data says a selected seat is gone, it has to leave the
   * selection. Doing that in a useEffect would mean one render where the cart
   * still totals a seat the user cannot have - and it trips React 19's
   * `set-state-in-effect` rule, which has already fired twice in this project.
   * Deriving it costs nothing and is correct on the very first render.
   */
  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => seatsById.get(id))
        .filter((seat): seat is Seat => seat?.status === "available"),
    [selectedIds, seatsById],
  );
  const selectedSet = useMemo(
    () => new Set(selected.map((seat) => seat.id)),
    [selected],
  );

  /**
   * How many seats the user had chosen that somebody else just took.
   *
   * `selected` already filters out anything no longer available, so the cart
   * self-corrects - which is correct but SILENT. Before T33 that only happened
   * after an explicit action the user had just taken, so the cause was obvious.
   * Now a seat can vanish from the cart while they are reading the map, and a
   * total that quietly drops with no explanation reads as a bug in our
   * arithmetic rather than as somebody else being faster.
   *
   * Derived, not stored: `selectedIds` only ever shrinks through an explicit
   * toggle or removal, so any gap between the two lengths IS the number taken
   * from under them. No effect, nothing to keep in sync.
   */
  const takenFromSelection = selectedIds.length - selected.length;

  function toggle(seat: Seat) {
    setError(null);
    setSelectedIds((current) => {
      if (current.includes(seat.id)) {
        setLimitHit(0); // freeing a seat clears the refusal notice
        return current.filter((id) => id !== seat.id);
      }
      if (selected.length >= MAX_SEATS) {
        setLimitHit((n) => n + 1);
        return current; // the click is refused, not queued
      }
      return [...current, seat.id];
    });
  }

  function remove(seat: Seat) {
    setLimitHit(0);
    setSelectedIds((current) => current.filter((id) => id !== seat.id));
  }

  /** One admission from a standing tier: the next unclaimed spot in the zone. */
  function addStanding(tierId: string) {
    const next = visibleSeats.find(
      (s) => s.tierId === tierId && s.status === "available" && !selectedSet.has(s.id),
    );
    if (next) toggle(next);
  }

  /**
   * Hand the held seats back on purpose.
   *
   * Pessimistic: nothing in the UI changes until the server has answered 200.
   * Clearing first and rolling back on failure would flash "released" at
   * someone whose seats are still held, which is the one thing a seat map must
   * never do.
   */
  const handleRelease = useCallback(async (): Promise<boolean> => {
    if (!held || releasing) return false;

    setReleasing(true);
    setError(null);

    try {
      const response = await fetch("/api/holds/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatIds: held.seats.map((s) => s.seatId) }),
      });

      if (response.status === 401) {
        router.push(`/login?next=/events/${eventId}/seats`);
        return false;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error?.message ?? "Could not release those seats.");
        return false;
      }

      const releasedIds: string[] = data?.seatIds ?? [];
      /* Paint them free immediately - the server already said so. */
      setJustReleased(new Set(releasedIds));
      setHeld(null);
      setMine(new Set());
      setSelectedIds([]);
      setCheckoutError(null);
      router.refresh();
      return true;
    } catch {
      setError("Network problem — your seats are still held. Try again.");
      return false;
    } finally {
      setReleasing(false);
    }
  }, [held, releasing, router, eventId]);

  /**
   * Turn the live hold into a Stripe Checkout Session and leave.
   *
   * Pessimistic in the same sense as `handleRelease`: nothing navigates until
   * the server has actually answered with a real session url. The navigation
   * itself is a full page load to `checkout.stripe.com`, not a Next route, so
   * it uses `window.location.href` rather than `router.push` - the latter is
   * for same-origin app routes and would not take the browser anywhere near
   * Stripe's hosted page.
   */
  const handleCheckout = useCallback(async () => {
    if (!held || checkoutPending || Date.now() < checkoutCooldownUntil) return;

    setCheckoutPending(true);
    setCheckoutError(null);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatIds: held.seats.map((s) => s.seatId) }),
      });

      if (response.status === 401) {
        router.push(`/login?next=/events/${eventId}/seats`);
        return;
      }

      const data = await response.json().catch(() => null);

      /* Same reasoning as submitHold's 429 branch: must not refresh (nothing
         about the seats changed, and firing again would feed the flood the
         server just asked to stop), and the cooldown is what actually makes
         the button unclickable rather than just complaining each time. */
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 5;
        setCheckoutError(
          data?.error?.message ?? "Too many checkout attempts. Please wait a moment.",
        );
        setCheckoutCooldownUntil(Date.now() + retryAfter * 1000);
        window.setTimeout(() => setCheckoutCooldownUntil(0), retryAfter * 1000);
        return;
      }

      if (!response.ok) {
        setCheckoutError(
          data?.error?.message ?? "Could not start checkout. Please try again.",
        );
        /* A HOLDS_INVALID failure means the server just found our hold is no
           longer what we believed it was - re-pull the real seat map rather
           than letting the UI keep disagreeing with the database. */
        router.refresh();
        return;
      }

      window.location.href = data.url;
    } catch {
      setCheckoutError("Network problem — check your connection and try again.");
    } finally {
      setCheckoutPending(false);
    }
  }, [held, checkoutPending, checkoutCooldownUntil, router, eventId]);

  /**
   * The hold ran out.
   *
   * Called once by HoldBanner when its countdown reaches zero. Everything here
   * is about not leaving the user holding a lie: the cart is emptied because
   * those seats are no longer theirs, `mine` is dropped so they stop rendering
   * as gold, and the router refresh re-reads Postgres so the map repaints them
   * as available.
   *
   * That last step is where T22 pays off visibly. No cron job released
   * anything - the seats simply stopped satisfying `expires_at > now()`, so the
   * very next read returns them as free.
   *
   * `useCallback` because it is an effect dependency in the banner; a fresh
   * identity each render would re-run that effect on every tick.
   */
  const handleExpiry = useCallback(() => {
    setSelectedIds([]);
    setMine(new Set());
    setLimitHit(0);
    /* `held` is deliberately NOT cleared. The banner needs to stay mounted to
       show its expired state - clearing it would make the bar vanish at the
       exact moment the user needs telling why their seats went. */
    router.refresh();
  }, [router]);

  /**
   * Claim the selected seats for real.
   *
   * Nothing about the outcome is decided here. The server owns the answer, and
   * this only translates it - which is the point: an optimistic UI that assumed
   * success would show four secured seats to two different people.
   */
  async function submitHold() {
    if (selected.length === 0 || pending || Date.now() < cooldownUntil) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatIds: selected.map((seat) => seat.id) }),
      });

      /* Signed out - send them to log in and bring them straight back. The API
         answers 401 rather than redirecting precisely so this choice is ours to
         make; a 307 would have had fetch() silently parse a login page. */
      if (response.status === 401) {
        router.push(`/login?next=/events/${eventId}/seats`);
        return;
      }

      const data = await response.json().catch(() => null);

      /* Rate limited. Handled apart from every other failure for two reasons.
         
         First, it must NOT refresh: a 429 means the server is shedding load, and
         firing a second request at that exact moment is the client amplifying
         the storm it was just told to stop. Nothing about the seats changed
         either, so there is nothing to re-fetch.
         
         Second, without a cooldown the user simply clicks again and collects
         another 429. Honouring Retry-After turns "you are going too fast" into
         the button actually not being clickable until it is safe. */
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 5;
        setError(
          data?.error?.message ?? "You're clicking too fast! Please wait a moment.",
        );
        setCooldownUntil(Date.now() + retryAfter * 1000);
        /* Set from an event handler, not a render-phase effect - React 19's
           set-state-in-effect rule has already fired twice in this project. */
        window.setTimeout(() => setCooldownUntil(0), retryAfter * 1000);
        return;
      }

      if (!response.ok) {
        setError(
          data?.error?.message ??
            "Could not hold those seats. Please try again.",
        );
        /* Re-pull the real map. Whatever went wrong, the seats on screen are
           now known to be out of date. */
        router.refresh();
        return;
      }

      setHeld(data as HoldSuccess);
      setMine(new Set((data as HoldSuccess).seats.map((s) => s.seatId)));
      setSelectedIds([]);
      setLimitHit(0);
      setCheckoutError(null);
      router.refresh();
    } catch {
      // A network failure is genuinely unknown: the hold may or may not exist.
      // Refreshing is what turns "unknown" back into "whatever the server says".
      setError("Network problem — check your connection and try again.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {/*
        THE CONNECTION STATE, SHOWN ONLY WHEN IT IS NOT FINE.

        A live map and a frozen one look identical, which is the problem: a
        socket that dropped silently leaves somebody choosing seats from a
        snapshot while believing they are watching the room. "live" therefore
        renders nothing - no badge, no reassurance, because a permanent green
        dot is noise - and only degradation is announced.

        Not `assertive`: this is context, not an interruption, and the user is
        mid-task on a grid they would lose their place in.
      */}
      {(realtime === "connecting" || realtime === "reconnecting") && (
        <p
          role="status"
          aria-live="polite"
          className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full bg-gold ${
              reduceMotion ? "" : "animate-pulse"
            }`}
          />
          {realtime === "connecting"
            ? "Connecting for live seat updates\u2026"
            : "Reconnecting \u2014 seats may be a few seconds behind"}
        </p>
      )}

      <TierLegend tiers={liveTiers} />

      {/*
        THE MAP FLOOR.

        Pure #000000, not a glass panel and not a lifted card. The architecture
        is drawn in hairlines at 6-10% white, and any backdrop blur or raised
        surface behind them would drown lines that thin. Glass is reserved for
        the legend above and the cart below, which are chrome floating over the
        room rather than part of it.
      */}
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black">
        <div className="px-4 pt-8 sm:px-6">
          <FocalEdge venueType={venueType} />
        </div>

        {/*
          The map scrolls inside its own box. A widest row is 22 seats -
          roughly 700px - which cannot fit a 375px phone at a tappable seat
          size. Shrinking the seats to fit would break the 24px pointer-target
          floor, so the container scrolls horizontally and the PAGE does not.
        */}
        <div className="overflow-x-auto overscroll-x-contain px-4 pb-10 pt-6 sm:px-6">
          <div className="relative mx-auto w-max min-w-full">
            <VenueFrame venueType={venueType} />

            <div className="relative flex flex-col items-center gap-6 py-4">
              {/* liveTiers, not tiers: a standing zone's remaining-admissions
                  count and its disabled state have to reflect what Realtime
                  just told us, or the zone stays clickable after it is full. */}
              {liveTiers.map((tier) => {
                /* ── STANDING: a zone, not seats ───────────────────────── */
                if (tier.isStanding) {
                  const left = tier.stats.available;
                  const chosen = selected.filter((s) => s.tierId === tier.id).length;

                  return (
                    <div key={tier.id} className="w-full px-2">
                      <motion.button
                        type="button"
                        disabled={left === 0 || left - chosen === 0}
                        onClick={() => addStanding(tier.id)}
                        onFocus={(e) => keepClearOfCart(e.currentTarget)}
                        whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                        className="group/zone flex h-20 w-full items-center justify-center rounded-xl border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-45"
                        style={{
                          borderColor: tier.color,
                          /* Diagonal hatching in the tier's own colour: a
                             standing area is a region you occupy, not a seat
                             you are assigned, and the texture says that
                             without a caption. */
                          backgroundImage: `repeating-linear-gradient(45deg, ${tier.color}22 0 6px, transparent 6px 14px)`,
                        }}
                        aria-label={`${tier.name}, ${formatPaise(tier.priceCents)} per admission, ${left} available. Add one admission.`}
                      >
                        <span className="text-center">
                          <span
                            className="block text-[11px] font-semibold uppercase tracking-[0.28em]"
                            style={{ color: tier.color }}
                          >
                            {tier.name}
                          </span>
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {left === 0 ? (
                              "Sold out"
                            ) : (
                              <>
                                <span className="tabular-nums">{left}</span> admissions left
                                {chosen > 0 && (
                                  <span className="tabular-nums text-gold-champagne">
                                    {" "}· {chosen} in cart
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        </span>
                      </motion.button>
                    </div>
                  );
                }

                /* ── SEATED: rows of individual seats ──────────────────── */
                const rows = groupRows(tier.id, visibleSeats);

                return (
                  <div key={tier.id} className="flex flex-col items-center gap-1.5">
                    <p
                      className="mb-1 text-[10px] font-medium uppercase tracking-[0.3em]"
                      style={{ color: tier.color }}
                    >
                      {tier.name}
                    </p>

                    {rows.map((row) => (
                      <div key={row.key} className="flex items-center gap-2">
                        <RowLabel label={row.label} />
                        <div className="flex gap-1">
                          {row.seats.map((seat, index) => (
                            <SeatWrapper
                              key={seat.id}
                              index={index}
                              count={row.seats.length}
                              venueType={venueType}
                            >
                              <SeatButton
                                seat={seat}
                                tier={tier}
                                selected={selectedSet.has(seat.id)}
                                mine={mine.has(seat.id)}
                                onToggle={toggle}
                              />
                            </SeatWrapper>
                          ))}
                        </div>
                        <RowLabel label={row.label} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Status key, so the four fills are legible without hovering a seat. */}
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
        <Key swatch={{ backgroundColor: "#1A1A1A", borderColor: "#A8A29E" }} label="Available" />
        <Key swatch={{ backgroundColor: "#FACC15", borderColor: "#FACC15" }} label="Selected" />
        <Key
          swatch={{ backgroundColor: "rgba(245,158,11,0.20)", borderColor: "rgba(245,158,11,0.45)" }}
          label="On hold"
        />
        {/* Kept in step with SeatButton's sold skin by hand - a legend that
            shows a different swatch from the thing it describes is worse than
            no legend. Raised with it from 1.08:1 to 3.60:1. */}
        <Key
          swatch={{ backgroundColor: "#121212", borderColor: "rgba(255,255,255,0.35)" }}
          label="Sold"
        />
        {mine.size > 0 && (
          <Key
            swatch={{ backgroundColor: "rgba(250,204,21,0.28)", borderColor: "#FACC15" }}
            label="Held by you"
          />
        )}
      </ul>

      {held ? (
        <HoldBanner
          seats={held.seats}
          expiresAtIso={held.expiresAt}
          totalCents={held.totalCents}
          eventId={eventId}
          replayed={held.replayed}
          onExpire={handleExpiry}
          onRelease={handleRelease}
          releasing={releasing}
          onCheckout={handleCheckout}
          checkoutPending={checkoutPending}
          checkoutError={checkoutError}
          checkoutCoolingDown={checkoutCooldownUntil > 0}
        />
      ) : (
        <CheckoutBar
          selected={selected}
          tiersById={tiersById}
          onRemove={remove}
          limitHit={limitHit}
          onCheckout={submitHold}
          pending={pending}
          coolingDown={cooldownUntil > 0}
          error={error}
          canHold={canHold}
          takenFromSelection={takenFromSelection}
        />
      )}
    </>
  );
}

function RowLabel({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="w-4 shrink-0 text-center text-[9px] font-medium tabular-nums text-white/25"
    >
      {label}
    </span>
  );
}

function Key({ swatch, label }: { swatch: React.CSSProperties; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className="size-3.5 rounded-[4px] border" style={swatch} />
      {label}
    </li>
  );
}

/**
 * Bends a flat flex row into an arc for arena venues.
 *
 * ── WHY A TRANSFORM AND NOT ABSOLUTE POSITIONING ───────────────────────────
 * The textbook radial layout positions every seat absolutely at
 * `rotate(θ) translate(r)`. That works, and it also hard-codes the container's
 * size in pixels, so the bowl stops matching its box the moment the layout
 * changes. Offsetting flex children instead keeps normal flow doing the
 * spacing - the row stays a row, it is just curved.
 *
 * Every row uses the same parabola, so the arcs stay parallel and rows never
 * collide no matter how deep the bowl gets. `transform` is also composited, so
 * bending 286 seats costs no layout work.
 *
 * The ends rise rather than fall: with the stage at the top, seats at the edges
 * of a row wrap up alongside it, which is the geometry of a real bowl.
 */
function SeatWrapper({
  index,
  count,
  venueType,
  children,
}: {
  index: number;
  count: number;
  venueType: VenueType;
  children: React.ReactNode;
}) {
  if (venueType !== "stadium" || count < 2) return <>{children}</>;

  /* -1 at the left end, 0 at centre, +1 at the right end. */
  const nx = (index / (count - 1)) * 2 - 1;

  return (
    <span
      className="inline-flex"
      style={{
        transform: `translateY(${(-28 * nx * nx).toFixed(2)}px) rotate(${(nx * 16).toFixed(2)}deg)`,
      }}
    >
      {children}
    </span>
  );
}
