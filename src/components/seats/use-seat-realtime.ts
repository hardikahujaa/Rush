"use client";

import { useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SeatStatus } from "@/lib/mock-data";

/** What the socket is doing, for the indicator in the UI. */
export type RealtimeState = "idle" | "connecting" | "live" | "reconnecting";

/** One seat's new status, as broadcast by Postgres. */
export type SeatChange = { id: string; status: SeatStatus };

/** What the channel last told us. Narrower than Supabase's status union. */
type ChannelPhase = "pending" | "subscribed" | "down";

/**
 * LIVE SEAT UPDATES (T33).
 *
 * ── WHY A MANAGED SERVICE AND NOT OUR OWN WEBSOCKET ────────────────────────
 * The obvious instinct is to open a WebSocket server in the app. On Vercel that
 * cannot work, for two independent reasons:
 *
 *   1. A serverless function is REQUEST-SCOPED. It is invoked for one request
 *      and frozen or discarded afterwards. There is no process left alive to
 *      hold the other end of a socket open between messages.
 *   2. Even if one could, there is NO SHARED BUS BETWEEN INSTANCES. A hold
 *      committed by instance A has no way to reach a socket held by instance B.
 *      Broadcasting requires a single place that knows about every open
 *      connection - which is, by definition, a stateful always-on service.
 *
 * Supabase Realtime is exactly that service. It tails Postgres's write-ahead
 * log and fans the changes out to subscribers.
 *
 * ── WHY `postgres_changes` AND NOT SUPABASE BROADCAST ──────────────────────
 * Broadcast would be cheaper at scale: the server publishes "seat X is held"
 * after the hold commits, with no publication and no RLS involved. It was
 * rejected because it introduces a SECOND write path that can fail AFTER the
 * transaction has committed - leaving the socket saying one thing and Postgres
 * another, with no way to tell which is right. T20, T22 and T28 were each spent
 * removing that exact class of divergence.
 *
 * `postgres_changes` is derived from the WAL, so it cannot disagree with the
 * database. Broadcast is the documented escape hatch if volume ever demands it.
 *
 * ── WHAT THIS HOOK DELIBERATELY DOES NOT DO ────────────────────────────────
 * It decides nothing. It reports what changed and lets the caller merge. And it
 * subscribes to `seats` only - never `holds`, whose rows carry `user_id`. A
 * seat's STATUS is a public fact; who is holding it is not, which is why
 * migration 0005 grants a read policy on exactly one of those two tables.
 */
export function useSeatRealtime({
  eventId,
  enabled,
  onChange,
  onResync,
}: {
  eventId: string;
  /** False for mock events, whose seat ids exist nowhere in Postgres. */
  enabled: boolean;
  /** Called for every seat whose status changed. */
  onChange: (change: SeatChange) => void;
  /**
   * Called whenever the client must refetch from scratch.
   *
   * THIS IS NOT OPTIONAL, and it is the subtlest part of the hook.
   * `postgres_changes` has NO BACKFILL - a subscriber receives changes that
   * happen while it is connected, and nothing else. So a thirty-second network
   * blip silently leaves the map permanently wrong, with no error anywhere,
   * which is worse than showing no live updates at all.
   *
   * Fired on every transition into `SUBSCRIBED`, which covers both the first
   * connection and every reconnect after one.
   *
   * The first one matters as much as the rest, which is not obvious: Supabase
   * reports `SUBSCRIBED` BEFORE the server-side feed is armed for the filter,
   * so a change in the first second or two after connecting is dropped without
   * a trace. Measured in `scripts/realtime-test.ts`. The caller must not skip
   * the first resync - see the note on `handleResync` in `seat-map.tsx`.
   */
  onResync: () => void;
}): RealtimeState {
  /**
   * ── ALL STATE HERE IS SET FROM THE CHANNEL CALLBACK, NEVER FROM THE EFFECT ─
   * The first version of this hook called `setState` in the effect body to show
   * "connecting", and React 19's `set-state-in-effect` rule refused it - for the
   * fourth time in this project. The fix is the same one that worked in
   * `seat-map.tsx` and the T29 success page: store only what an external system
   * reports, and DERIVE everything else.
   *
   * `phase` is written solely inside `.subscribe(...)`, which is a callback from
   * outside React and therefore exactly what the rule permits.
   */
  const [phase, setPhase] = useState<ChannelPhase>("pending");
  const [everLive, setEverLive] = useState(false);

  /**
   * Reset when the subscription identity changes, during render.
   *
   * React's documented way to adjust state when a prop changes - it discards
   * the in-progress render and redoes it without committing. Navigating to a
   * different event is a genuinely fresh connection, so it should read as
   * "connecting", not "reconnecting".
   */
  const identity = `${eventId}:${enabled}`;
  const [identitySeen, setIdentitySeen] = useState(identity);
  if (identity !== identitySeen) {
    setIdentitySeen(identity);
    setPhase("pending");
    setEverLive(false);
  }

  /**
   * The callbacks live in refs so the effect does not depend on them.
   *
   * Without this, a parent that recreates `onChange` each render would tear the
   * channel down and rebuild it on every render - and since each subscribe
   * fires `onResync`, that would be an accidental refetch loop pointed at our
   * own server. The effect depends on `eventId` and `enabled` only, which are
   * the two things that genuinely mean "a different subscription".
   */
  const onChangeRef = useRef(onChange);
  const onResyncRef = useRef(onResync);

  /**
   * Synced in an effect, not during render.
   *
   * React 19 forbids writing a ref while rendering (`react-hooks/refs`), and it
   * is right to: a render can be thrown away, so a write during one is a side
   * effect on a pass that may never commit. `useRef(onChange)` already seeds
   * the correct initial value, so the channel callback can never observe a
   * stale function even if this effect has not run yet.
   */
  useEffect(() => {
    onChangeRef.current = onChange;
    onResyncRef.current = onResync;
  }, [onChange, onResync]);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createSupabaseBrowserClient();

    /* Named per event, so two tabs on different events never share a channel
       and a stale channel from a previous navigation cannot collide. */
    const channel = supabase
      .channel(`seats:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "seats",
          /**
           * The filter is load-bearing, not an optimisation. Without it every
           * client receives every seat change for every event in the database -
           * eleven events of 288 seats - and pays to decode changes for rooms
           * nobody is looking at.
           *
           * INSERT and DELETE are absent because seats are created once by the
           * seed and never removed; the only thing that happens to a seat row
           * afterwards is its status changing.
           */
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string; status?: SeatStatus } | null;
          if (!row?.id || !row.status) return;
          onChangeRef.current({ id: row.id, status: row.status });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setPhase("subscribed");
          setEverLive(true);
          /* Refetch on EVERY subscribe, first or not - see onResync. The
             caller must not skip the first: the feed is not armed the instant
             this fires, so an early change can be lost silently. */
          onResyncRef.current();
          return;
        }

        /* `CLOSED` also arrives during ordinary teardown, but the cleanup below
           runs first in that case, so a stale "reconnecting" is never painted
           after unmount. */
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setPhase("down");
        }
      });

    return () => {
      /* `removeChannel` rather than `channel.unsubscribe()`: the former also
         drops it from the client's registry, so React 19's StrictMode
         double-mount cannot leave an orphaned channel holding a socket open for
         the life of the page. */
      void supabase.removeChannel(channel);
    };
  }, [eventId, enabled]);

  /* Derived, so there is no state to keep in sync with the channel. */
  if (!enabled) return "idle";
  if (phase === "subscribed") return "live";
  return everLive ? "reconnecting" : "connecting";
}
