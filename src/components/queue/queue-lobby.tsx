"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, Users, WifiOff } from "lucide-react";

import { useSecondTick } from "@/components/seats/use-second-tick";

import { AdmissionCurtain } from "./admission-curtain";
import { PositionTicker } from "./position-ticker";
import { QueueProgress } from "./queue-progress";
import { QueueStats } from "./queue-stats";
import { StatusTicker } from "./status-ticker";
import { useQueuePosition } from "./use-queue-position";
import { WaitEstimate } from "./wait-estimate";

/**
 * THE LOBBY (T35).
 *
 * T34 built this as one 384-line client component in the route folder. T35
 * splits it into a hook that owns every piece of state and a set of children
 * that are pure functions of props - which is the whole defence against the two
 * bugs this screen attracts. There is exactly one place in the feature that can
 * call `setState` (`use-queue-position.ts`) and it is not inside any animation;
 * and nothing below reads a clock or a random number during render.
 *
 * It also moves to `src/components/queue/` per CLAUDE.md, which wants feature
 * components under `src/components/<feature>/` rather than beside the route.
 *
 * ── THE CLOCK IS SUBSCRIBED ONCE, HERE ────────────────────────────────────
 * `useSecondTick`'s `subscribe` starts an interval per CONSUMER, so calling it
 * inside each child would run three timers to read one clock. T33 settled this
 * convention with 288 seat buttons: subscribe once at the top, pass the value
 * down. `tick` is 0 until hydration, and every consumer treats 0 as "render the
 * server's answer" - which is what keeps the first paint identical to the HTML.
 *
 * ── WHY POLLING AND NOT A WEBSOCKET ──────────────────────────────────────
 * T33 opens a real socket for seat updates, so the question is fair. A queue
 * position is not a row - it is a RANK inside a sorted set, which changes for
 * everyone every time one person is admitted, so broadcasting it is ten
 * thousand messages for one event. And the answer is different for every
 * client, which is the one case where pulling genuinely beats pushing.
 */
export function QueueLobby({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const reduceMotion = useReducedMotion();
  const tick = useSecondTick();
  const { phase, position, peak, online, lastOkAt, inFlight } =
    useQueuePosition(eventId);

  const seatsHref = `/events/${eventId}/seats`;

  /* ── admitted ───────────────────────────────────────────────────────────── */
  if (phase === "admitting") {
    return <AdmissionCurtain seatsHref={seatsHref} />;
  }

  /* ── joining ────────────────────────────────────────────────────────────── */
  if (phase === "joining" || !position) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="glass live-pulse relative rounded-2xl border-gold/20 px-6 py-16 text-center"
      >
        <Loader2 className="mx-auto size-6 animate-spin text-gold" aria-hidden="true" />
        <p className="mt-5 text-sm text-foreground">Taking your place in line</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {online
            ? "This takes a moment."
            : "Having trouble reaching the server — still trying."}
        </p>
      </div>
    );
  }

  /* ── waiting ────────────────────────────────────────────────────────────── */
  const nextUp = position.ahead === 0;

  return (
    /*
      `live-pulse` is the ambient motion this screen needs, and it already
      exists: a champagne sliver travelling the panel's edge on a 6s loop,
      defined in globals.css and already switched off under
      `prefers-reduced-motion`. It is CSS, so it costs no JavaScript and keeps
      running while React is busy - which is exactly the property you want from
      the one element proving the page is not frozen. `relative` is required for
      its `inset-0` ::before.
    */
    <div className="glass live-pulse relative rounded-2xl border-gold/20 px-6 py-10 sm:px-10">
      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gold-champagne/70">
          {nextUp ? "You're next" : "People ahead of you"}
        </p>

        <PositionTicker ahead={position.ahead} />

        {/*
          THE ONE LIVE REGION IN THE LOBBY.

          Visually hidden because the number above already says it, but it is
          the only thing announced - `polite`, so a screen reader finishes its
          sentence first. The rotating ticker and the per-second heartbeat are
          both `aria-hidden`: a region that changes every second would make the
          position the user came for impossible to hear.
        */}
        <p role="status" aria-live="polite" className="sr-only">
          {nextUp
            ? "You are next in line."
            : `${position.ahead} ${position.ahead === 1 ? "person" : "people"} ahead of you.`}
        </p>

        <WaitEstimate
          etaSeconds={position.etaSeconds}
          lastOkAt={lastOkAt}
          tick={tick}
          inFlight={inFlight}
          nextUp={nextUp}
        />
      </div>

      <QueueProgress ahead={position.ahead} peak={peak} />

      <StatusTicker
        ahead={position.ahead}
        inFlight={inFlight}
        online={online}
        tick={tick}
      />

      <div className="rule-fade mx-auto mt-2 h-px w-full" />

      <QueueStats
        waitingTotal={position.waitingTotal}
        admittedCount={position.admittedCount}
        capacity={position.capacity}
      />

      {/*
        Connection trouble is additive, never destructive. T34 got this right
        and it is worth keeping explicit: a single dropped request must not
        blank out a position the user has watched for four minutes. The readout
        stays, the heartbeat above says when it was last true, and this line
        explains what is happening and that the place is safe.

        Reserved height so appearing and disappearing does not shift the panel.
      */}
      <div className="flex min-h-5 items-center justify-center">
        <AnimatePresence initial={false}>
          {!online && (
            <motion.p
              key="offline"
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-5 flex items-center justify-center gap-2 text-xs text-gold-champagne"
            >
              <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
              Reconnecting — your place is held for a minute
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <p className="mt-6 flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-muted-foreground">
        <Users className="size-3.5 shrink-0 text-gold/70" aria-hidden="true" />
        Keep this tab open. Opening {eventTitle} in another tab won&rsquo;t move
        you up.
      </p>
    </div>
  );
}
