import "server-only";

import { NextResponse } from "next/server";

import type { EventQueueInfo } from "@/db/queries/events";
import { isQueueConfigured, isQueueWindowOpen, type QueuePosition } from "@/lib/queue";
import { issueAdmission } from "@/lib/queue-gate";

/**
 * Turning a queue verdict into an HTTP response.
 *
 * ── WHY THIS IS A SEPARATE FILE FROM `queue-api.ts` ────────────────────────
 * It was one module until `scripts/queue-test.ts` tried to import it and the
 * process died on `React.createContext is not a function`. The chain is worth
 * recording, because it is not obvious: the request prelude needs
 * `getCurrentUser()`, `lib/auth` imports `redirect` from `next/navigation`,
 * and that module pulls in the App Router's React context - which cannot be
 * evaluated under `--conditions=react-server`, the flag every verification
 * script in this repo runs with.
 *
 * So the half that can be tested in isolation lives here, with no dependency on
 * authentication at all, and `queue-api.ts` keeps the half that needs a real
 * request. The split is not cosmetic: the fail-open policy below is the single
 * most consequential decision in T34, and it is now directly assertable.
 */

/** Every failure leaves through here, so the shape matches the rest of the API. */
export function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Everything the response needs to know about who is asking. */
export type QueueContext = { userId: string; event: EventQueueInfo };

/**
 * Is a queue running for this event right now?
 *
 * Split out from `prepareQueueRequest` because the answer is not an error. If
 * no drop is in progress the seat map is ungated, so the honest reply is "go
 * ahead" - and the lobby page sends the user straight through on receiving it.
 */
export function queueRunning(event: EventQueueInfo): boolean {
  return isQueueConfigured() && isQueueWindowOpen(event);
}

/**
 * How long the client should wait before asking again.
 *
 * ── THE SERVER PICKS THE CADENCE, NOT THE CLIENT ───────────────────────────
 * This looks like a client concern and is not. Only the server knows how deep
 * the line is, and the right interval depends entirely on that: somebody two
 * places from the front needs to know within a second, while somebody four
 * thousand back asking every second is ten thousand clients generating ten
 * thousand Redis round trips per second to learn a number that has barely
 * moved.
 *
 * Having the server decide also means the cadence can be changed during an
 * incident without shipping a new client, and - the real reason - a client
 * cannot opt out of it by editing a constant.
 *
 * ── AND IT IS JITTERED ─────────────────────────────────────────────────────
 * Everybody in the queue arrived within the same few seconds, so a fixed
 * interval keeps them in lockstep forever: every poll lands in the same
 * millisecond, and the load profile is a spike train rather than a flat line.
 * +/-20% of random spread breaks the convoy apart within a few cycles. Same
 * reasoning as the debounce-and-jitter on the T33 seat-map refresh.
 */
export function pollAfterMs(ahead: number): number {
  const base =
    ahead <= 20 ? 1_500 : ahead <= 200 ? 3_000 : ahead <= 1_000 ? 6_000 : 12_000;
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/**
 * Turn a `QueuePosition` into the HTTP answer, setting the pass when admitted.
 *
 * One mapping shared by join and poll, so the two endpoints cannot disagree
 * about what admission means or forget to set the cookie.
 *
 * ── THE `unavailable` BRANCH IS THE DELIBERATE FAIL-OPEN ───────────────────
 * Redis configured but not answering is the one case where this hands out a
 * pass without having checked a position, and that is the correct call for the
 * same reason the rate limiter allows a request when Redis is down: the queue
 * is a THROUGHPUT control, and every correctness rule lives in Postgres. The
 * row lock, the partial unique index and the four-seat cap are all untouched by
 * a Redis outage, so nothing can be oversold - the drop simply runs without a
 * throttle.
 *
 * Failing closed would mean a blip in the component that guards against load
 * becomes a total outage of ticket sales, which trades a partial, hypothetical
 * problem for a real and complete one.
 *
 * It is logged loudly and reported to the client as `degraded`, because a
 * silent fail-open is indistinguishable from a queue that was never working.
 */
export function respondToPosition(
  position: QueuePosition,
  ctx: QueueContext,
): NextResponse {
  if (position.state === "admitted" || position.state === "unavailable") {
    const degraded = position.state === "unavailable";
    if (degraded) {
      console.error(
        `[queue] FAILING OPEN for event ${ctx.event.id}: Redis did not answer, ` +
          "so this user was admitted without a position check. Seat correctness " +
          "is unaffected (Postgres enforces it); the drop is unthrottled.",
      );
    }

    const response = NextResponse.json({ state: "admitted", degraded });
    if (!issueAdmission(response, ctx.event.id, ctx.userId)) {
      /* Unreachable in production - the guard in queue.ts throws at import
         without a secret - and a 503 rather than a silent pass if it ever is
         reached, because the alternative is an unsigned cookie the gate would
         have to trust. */
      return fail(
        503,
        "QUEUE_UNCONFIGURED",
        "The waiting room is not available. Please try again shortly.",
      );
    }
    return response;
  }

  if (position.state === "not_in_queue") {
    return NextResponse.json({ state: "not_in_queue" });
  }

  return NextResponse.json({
    state: "waiting",
    ahead: position.ahead,
    waitingTotal: position.waitingTotal,
    admittedCount: position.admittedCount,
    capacity: position.capacity,
    etaSeconds: position.etaSeconds,
    pollAfterMs: pollAfterMs(position.ahead),
  });
}
