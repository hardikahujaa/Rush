"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, Users, WifiOff } from "lucide-react";

/** What `/api/queue/position` and `/api/queue/join` can answer. */
type Waiting = {
  ahead: number;
  waitingTotal: number;
  admittedCount: number;
  capacity: number;
  etaSeconds: number | null;
  pollAfterMs: number;
};

type Phase = "joining" | "waiting" | "admitted";

/**
 * THE LOBBY (T34).
 *
 * A client component because it has to poll, and polling needs a timer and
 * state. Everything around it - the event title, the venue, the gate decision
 * that sent the user here - is rendered on the server; this is the smallest
 * possible interactive leaf, which is the rule in CLAUDE.md.
 *
 * ── WHY POLLING AND NOT A WEBSOCKET ───────────────────────────────────────
 * T33 opens a real socket for seat updates, so the obvious question is why this
 * does not. Two reasons:
 *
 *   1. The socket carries Postgres row changes. A queue position is not a row -
 *      it is a RANK inside a Redis sorted set, which changes for ten thousand
 *      people every time one person is admitted. Broadcasting that is ten
 *      thousand messages for one event.
 *   2. The position only matters to the person asking. Polling is the one case
 *      where the pull model is genuinely cheaper than the push model, because
 *      each client needs a different answer.
 *
 * ── THE INTERVAL COMES FROM THE SERVER ────────────────────────────────────
 * `pollAfterMs` arrives in the payload, already jittered. The client does not
 * get to choose: only the server knows how deep the line is, and someone four
 * thousand back asking every second is pure load for a number that has barely
 * moved. See `pollAfterMs` in `lib/queue-api.ts`.
 */
export function QueueLobby({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("joining");
  const [pos, setPos] = useState<Waiting | null>(null);
  /**
   * Connection trouble, tracked SEPARATELY from the position.
   *
   * The instinct is one state machine with an `error` phase, and it produces a
   * bad waiting room: a single dropped request would blank out the position the
   * user has been watching for four minutes and replace it with an error. The
   * last known position is still the best information available, so a blip
   * dims the number and adds a line of explanation rather than destroying it.
   */
  const [offline, setOffline] = useState(false);
  /**
   * The furthest back this user has been, which is what makes a progress bar
   * possible at all. "Ahead: 412" means nothing on its own; "412 of the 1,290
   * you started behind" is progress.
   *
   * Monotonic by construction - `Math.max` - because the line can grow behind
   * you and your own position can briefly rise if someone ahead rejoins. A bar
   * that went backwards would read as the queue cheating.
   */
  const [peak, setPeak] = useState(0);

  const seatsHref = `/events/${eventId}/seats`;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (kind: "join" | "poll", ms: number) => {
      timer = setTimeout(() => void step(kind), ms);
    };

    const arrive = () => {
      setPhase("admitted");
      /**
       * The pass is now in the cookie jar - `fetch` applies a same-origin
       * `Set-Cookie` before this promise resolves - so the next request to the
       * seat map carries it and the gate lets them through.
       *
       * `router.replace`, not `push`: the lobby must not be in the back-stack.
       * Pressing back from the seat map should return to the event page, not to
       * a waiting room the user has already left.
       *
       * The "You're in" screen renders underneath with a real link, so if this
       * navigation is ever slow or blocked the user is one tap from the seats
       * rather than stranded watching a spinner.
       */
      router.replace(seatsHref);
    };

    async function step(kind: "join" | "poll") {
      if (cancelled) return;

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

        /* Throttled. The server already said exactly how long to wait, so
           honour it rather than guessing - and never give up: being rate
           limited is not a reason to lose your place in line. */
        if (res.status === 429) {
          const after = Number(res.headers.get("Retry-After"));
          setOffline(false);
          schedule(kind, (Number.isFinite(after) && after > 0 ? after : 5) * 1000);
          return;
        }

        /* The session expired while they waited. Sign in and come straight
           back - `next` points at the lobby, so their place is picked up. */
        if (res.status === 401) {
          router.replace(
            `/login?next=${encodeURIComponent(`/events/${eventId}/queue`)}`,
          );
          return;
        }

        if (!res.ok) {
          setOffline(true);
          schedule("poll", 4_000);
          return;
        }

        const data = (await res.json()) as
          | { state: "admitted" }
          | { state: "open" }
          | { state: "not_in_queue" }
          | ({ state: "waiting" } & Waiting);

        if (cancelled) return;
        setOffline(false);

        /* `open` means the drop window closed while they waited: there is no
           queue any more, so the seat map is simply open. Same destination. */
        if (data.state === "admitted" || data.state === "open") {
          arrive();
          return;
        }

        /* Swept as abandoned - a laptop that slept, or a tab left in the
           background long enough to miss four polls. Rejoin immediately rather
           than reporting an error nobody can act on. The place is lost, which
           is the honest cost of having gone away. */
        if (data.state === "not_in_queue") {
          schedule("join", 300);
          return;
        }

        setPos(data);
        setPeak((p) => Math.max(p, data.ahead));
        setPhase("waiting");
        schedule("poll", data.pollAfterMs);
      } catch {
        /* Offline, a flaky connection, or the tab was frozen mid-request.
           Keep trying: the spot survives for 60 seconds without a poll, so a
           brief outage costs nothing. */
        if (cancelled) return;
        setOffline(true);
        schedule("poll", 4_000);
      }
    }

    void step("join");

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [eventId, router, seatsHref]);

  /* ── admitted ───────────────────────────────────────────────────────────── */
  if (phase === "admitted") {
    return (
      <div className="glass rounded-2xl border-gold/30 px-6 py-14 text-center">
        <motion.div
          initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-gold/15 ring-1 ring-gold/40"
        >
          <Check className="size-7 text-gold-champagne" aria-hidden="true" />
        </motion.div>

        <h2 className="text-metal mt-6 text-3xl font-bold tracking-[-0.03em]">
          You&rsquo;re in
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Opening the seat map&hellip;
        </p>

        <Link
          href={seatsHref}
          className="btn-gold mt-7 inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Choose seats
        </Link>
      </div>
    );
  }

  /* ── joining ────────────────────────────────────────────────────────────── */
  if (phase === "joining" || !pos) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="glass rounded-2xl border-gold/20 px-6 py-16 text-center"
      >
        <Loader2
          className="mx-auto size-6 animate-spin text-gold"
          aria-hidden="true"
        />
        <p className="mt-5 text-sm text-foreground">Taking your place in line</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {offline
            ? "Having trouble reaching the server — still trying."
            : "This takes a moment."}
        </p>
      </div>
    );
  }

  /* ── waiting ────────────────────────────────────────────────────────────── */
  const progress = peak > 0 ? Math.min(1, (peak - pos.ahead) / peak) : 0;
  const next = pos.ahead === 0;

  return (
    <div className="glass rounded-2xl border-gold/20 px-6 py-10 sm:px-10">
      {/*
        One live region for the whole readout, polite rather than assertive.
        A screen reader should hear the position when it changes, not be
        interrupted mid-sentence every few seconds by a number that moved by
        one - which is what `assertive` would do for the entire wait.
      */}
      <div role="status" aria-live="polite" className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gold-champagne/70">
          {next ? "You're next" : "People ahead of you"}
        </p>

        {/*
          The number is keyed on its own value, so React remounts it on every
          change and the entrance animation actually plays. Without the key it
          would be the same element with new text and the motion would never
          fire - a real trap with Framer Motion.
        */}
        <motion.p
          key={pos.ahead}
          initial={reduceMotion ? false : { y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={[
            "text-metal mt-2 text-6xl font-bold tabular-nums leading-none tracking-[-0.04em] sm:text-7xl",
            /* Dimmed while the connection is down: the number is still the
               best information we have, but it may be stale and saying so
               silently is better than either hiding it or implying it is
               live. */
            offline ? "opacity-50" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {next ? "Next" : pos.ahead.toLocaleString("en-IN")}
        </motion.p>

        <p className="mt-4 text-sm text-muted-foreground">
          {next
            ? "A spot is about to open — stay on this page."
            : pos.etaSeconds === null
              ? "Estimated wait: calculating…"
              : `Estimated wait: ${formatEta(pos.etaSeconds)}`}
        </p>
      </div>

      {/* Progress. Only once there is something to measure against - a bar
          pinned at zero for the first poll looks broken. */}
      {peak > 0 && (
        <div className="mt-8">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="Queue progress"
          >
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-gold-deep via-gold to-gold-champagne"
              initial={false}
              animate={{ width: `${Math.max(2, progress * 100)}%` }}
              transition={
                reduceMotion ? { duration: 0 } : { duration: 0.8, ease: "easeOut" }
              }
            />
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            You started {peak.toLocaleString("en-IN")} back
          </p>
        </div>
      )}

      <div className="rule-fade mx-auto mt-8 h-px w-full" />

      <dl className="mt-6 grid grid-cols-2 gap-4 text-center">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            In line
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {pos.waitingTotal.toLocaleString("en-IN")}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Buying now
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {pos.admittedCount.toLocaleString("en-IN")}
            <span className="text-sm font-normal text-muted-foreground">
              {" / "}
              {pos.capacity.toLocaleString("en-IN")}
            </span>
          </dd>
        </div>
      </dl>

      {offline && (
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-gold-champagne">
          <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
          Reconnecting — your place is held for a minute
        </p>
      )}

      <p className="mt-7 flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-muted-foreground">
        <Users className="size-3.5 shrink-0 text-gold/70" aria-hidden="true" />
        Keep this tab open. Opening {eventTitle} in another tab won&rsquo;t move
        you up.
      </p>
    </div>
  );
}

/**
 * Human wait times, deliberately vague at the top end.
 *
 * The estimate is derived from how fast the line moved in the last minute, so
 * it is genuinely uncertain - printing "27 minutes" implies a precision that
 * does not exist and that the user will hold us to. Rounded buckets are honest
 * about what is actually known.
 */
function formatEta(seconds: number): string {
  if (seconds <= 45) return "less than a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes <= 1) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "over an hour" : `about ${hours} hours`;
}
