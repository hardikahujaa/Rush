"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** The waiting payload from `GET /api/queue/position`. */
export type QueueWaiting = {
  ahead: number;
  waitingTotal: number;
  admittedCount: number;
  capacity: number;
  etaSeconds: number | null;
  pollAfterMs: number;
};

/**
 * One-way, and that is enforced.
 *
 * `joining` -> `waiting` -> `admitting`. Nothing ever moves backwards, which is
 * what lets the handoff be a committed animation rather than something a late
 * response can interrupt.
 */
export type QueuePhase = "joining" | "waiting" | "admitting";

export type QueueSnapshot = {
  phase: QueuePhase;
  position: QueueWaiting | null;
  /** The furthest back this browser has seen itself. Monotonic. */
  peak: number;
  /** The last request succeeded. False dims the readout, never hides it. */
  online: boolean;
  /** Unix ms of the last successful poll. 0 before the first one. */
  lastOkAt: number;
  /** A request is genuinely open right now. */
  inFlight: boolean;
};

/**
 * How long the success state is held before navigating.
 *
 * ── A DELIBERATE PAUSE, NOT A LOADING DELAY ───────────────────────────────
 * PLAN.md asks for a redirect "the instant you're admitted". After a wait that
 * may have run for minutes, an instant snap to a different page reads as a
 * crash - the user never sees that they succeeded, only that the thing they
 * were watching vanished. A beat of about a second is long enough to register
 * "I'm in" and short enough that nobody feels held up.
 *
 * Nothing depends on it for correctness: the pass is already in the cookie jar
 * when this starts, and the curtain carries a real link, so a navigation that
 * never fires leaves the user one tap from the seats rather than stranded.
 */
export const ADMISSION_HOLD_MS = 1_100;

/**
 * THE ONLY STATEFUL NODE IN THE LOBBY.
 *
 * Every piece of network handling and phase management lives here so that every
 * component below is a pure function of props. That split is the whole defence
 * against the two failure modes this kind of screen attracts: there is exactly
 * one place in the feature that can call `setState`, and it is not inside any
 * animation.
 *
 * Lifted wholesale from T34's `queue-lobby.tsx`, with the handoff and the
 * `inFlight`/`lastOkAt` heartbeat added for T35.
 */
export function useQueuePosition(eventId: string): QueueSnapshot {
  const router = useRouter();

  const [snap, setSnap] = useState<QueueSnapshot>({
    phase: "joining",
    position: null,
    peak: 0,
    online: true,
    lastOkAt: 0,
    /* Starts true because the effect fires the join request immediately. Seeded
       here rather than set in the effect body - see the note on the deferred
       first step below. */
    inFlight: true,
  });

  const seatsHref = `/events/${eventId}/seats`;

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let handoff: ReturnType<typeof setTimeout> | undefined;

    /* Closure flag rather than a `useRef`. React 19 forbids writing a ref during
       render (`react-hooks/refs`, which has already fired in this project), and
       nothing outside this effect needs to read it. */
    let handedOff = false;

    const schedule = (kind: "join" | "poll", ms: number) => {
      poll = setTimeout(() => void step(kind), ms);
    };

    /**
     * Commit to leaving. Idempotent, and it stops the world first.
     *
     * ── CANCELLING THE LOOP HERE IS THE SUBTLE PART ─────────────────────────
     * The pass is set by the response that got us here, so the navigation
     * itself is safe. What is not safe is the request that may already be in
     * flight: without `cancelled = true`, it resolves two hundred milliseconds
     * later, calls `setSnap`, and pushes the lobby's waiting UI back on screen
     * underneath a curtain that is mid-animation. The `handedOff` guard covers
     * the other direction - a second `admitted` payload must not restart the
     * timer or fire a second `router.replace`.
     */
    const arrive = () => {
      if (handedOff) return;
      handedOff = true;
      cancelled = true;
      if (poll) clearTimeout(poll);

      setSnap((s) => ({ ...s, phase: "admitting", inFlight: false, online: true }));
      handoff = setTimeout(() => router.replace(seatsHref), ADMISSION_HOLD_MS);
    };

    async function step(kind: "join" | "poll") {
      if (cancelled) return;
      setSnap((s) => (s.inFlight ? s : { ...s, inFlight: true }));

      try {
        const res =
          kind === "join"
            ? await fetch("/api/queue/join", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ eventId }),
              })
            : await fetch(
                `/api/queue/position?eventId=${encodeURIComponent(eventId)}`,
                { cache: "no-store" },
              );

        if (cancelled) return;

        /* Throttled. T34 already said exactly how long to wait, so honour it
           rather than guessing - and never give up: being rate limited is not a
           reason to lose a place in line. */
        if (res.status === 429) {
          const after = Number(res.headers.get("Retry-After"));
          setSnap((s) => ({ ...s, inFlight: false, online: true }));
          schedule(kind, (Number.isFinite(after) && after > 0 ? after : 5) * 1000);
          return;
        }

        /* The session expired mid-wait. `next` points back at the lobby, so
           signing in resumes rather than restarts. */
        if (res.status === 401) {
          cancelled = true;
          router.replace(`/login?next=${encodeURIComponent(`/events/${eventId}/queue`)}`);
          return;
        }

        if (!res.ok) {
          setSnap((s) => ({ ...s, inFlight: false, online: false }));
          schedule("poll", 4_000);
          return;
        }

        const data = (await res.json()) as
          | { state: "admitted" }
          | { state: "open" }
          | { state: "not_in_queue" }
          | ({ state: "waiting" } & QueueWaiting);

        if (cancelled) return;

        /* `open` means the drop window closed while they waited: no queue any
           more, so the seat map is simply open. Same destination, same beat. */
        if (data.state === "admitted" || data.state === "open") {
          arrive();
          return;
        }

        /* Swept as abandoned - a sleeping laptop, or a background tab that
           missed four polls. Rejoin at once rather than reporting an error
           nobody can act on. */
        if (data.state === "not_in_queue") {
          setSnap((s) => ({ ...s, inFlight: false, online: true }));
          schedule("join", 300);
          return;
        }

        const now = Date.now();
        setSnap((s) => ({
          phase: "waiting",
          position: data,
          peak: Math.max(s.peak, data.ahead),
          online: true,
          lastOkAt: now,
          inFlight: false,
        }));
        schedule("poll", data.pollAfterMs);
      } catch {
        /* Offline, flaky, or the tab was frozen mid-request. Keep trying: T34
           holds the spot for sixty seconds without a poll, so a brief outage
           costs nothing. */
        if (cancelled) return;
        setSnap((s) => ({ ...s, inFlight: false, online: false }));
        schedule("poll", 4_000);
      }
    }

    /**
     * Deferred by a tick, on purpose.
     *
     * Calling `step()` directly here would run its first `setSnap` - everything
     * before the first `await` - synchronously inside the effect body, which is
     * what React 19's `set-state-in-effect` rule refuses. A zero-delay timeout
     * moves it onto the next task, after the effect has returned.
     */
    poll = setTimeout(() => void step("join"), 0);

    return () => {
      cancelled = true;
      if (poll) clearTimeout(poll);
      /* The handoff timer must go too, or unmounting mid-beat navigates a page
         the user has already left. */
      if (handoff) clearTimeout(handoff);
    };
  }, [eventId, router, seatsHref]);

  return snap;
}
