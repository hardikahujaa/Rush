import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { hasBusinessInFlight } from "@/db/queries/queue";
import {
  isQueueActive,
  type QueueableEvent,
} from "@/lib/queue";
import {
  admissionCookieName,
  signAdmission,
  verifyAdmission,
} from "@/lib/queue-token";

/**
 * THE GATE (T34).
 *
 * One function, called from both places that must not be reachable without an
 * admission: the seat map page and `POST /api/holds`. Having one implementation
 * is the point - two copies of a rule like this drift, and the copy that drifts
 * is the hole.
 *
 * ── WHY THIS IS NOT IN `src/proxy.ts` ──────────────────────────────────────
 * Putting it in the proxy is the obvious design and it was rejected, for three
 * reasons that compound:
 *
 *   1. The gate needs to know the event's `status` and `dropAt` to decide
 *      whether a queue is even running, and the exemption below needs a
 *      Postgres query. The proxy runs on EVERY matched request in the app, so
 *      that is a database round trip on every page view to protect one route.
 *   2. Next's own documentation says proxy "should not be used as a full
 *      session management or authorization solution". A queue gate is exactly
 *      the authorization-shaped logic that warning is about.
 *   3. A matcher typo in the proxy fails SILENTLY - the build passes, dev
 *      starts, and every request skips the file. That failure mode has already
 *      cost this project once (see the `src/proxy.ts` note in CLAUDE.md). A
 *      guard that lives INSIDE the thing it protects cannot be routed around.
 *
 * This is the same two-layer reasoning as `requireRole()`: the cheap optimistic
 * check can live anywhere, but the check that actually enforces the rule runs
 * in the page and the route handler.
 */

export type GateVerdict =
  /** Proceed. `reason` is for logging and for the test script, not for logic. */
  | { allowed: true; reason: "queue_off" | "admitted" | "in_flight" }
  /** Send them to the lobby. */
  | { allowed: false; reason: "no_admission" }
  /** The queue is running and we do not know who this is. */
  | { allowed: false; reason: "signed_out" };

/**
 * May this user be on the seat map for this event right now?
 *
 * ── ORDER OF CHECKS IS COST, ASCENDING ─────────────────────────────────────
 * The window test is pure arithmetic on a row we already have. The cookie check
 * is an HMAC, so microseconds and no network. Only the exemption touches
 * Postgres, and it is reached only by someone who is inside an active drop
 * without a valid pass - which during normal operation is nobody.
 */
export async function checkGate({
  event,
  eventId,
  userId,
}: {
  event: QueueableEvent;
  eventId: string;
  /** Null for a signed-out visitor. */
  userId: string | null;
}): Promise<GateVerdict> {
  /* 1. No drop in progress - or the queue is not configured at all, in which
        case it is disabled rather than closed. See `isQueueConfigured`. */
  if (!isQueueActive(event)) return { allowed: true, reason: "queue_off" };

  /**
   * 2. During a drop we must be able to name the person in the line.
   *
   * An anonymous queue cannot work: with no identity there is nothing to key a
   * place in the sorted set on, so "my position" is unanswerable and one person
   * could take ten thousand places. Signing in is therefore a precondition of
   * queueing, not an unrelated inconvenience - which is also how every real
   * ticketing waiting room behaves.
   */
  if (!userId) return { allowed: false, reason: "signed_out" };

  /**
   * 3. A valid admission cookie.
   *
   * `verifyAdmission` checks the signature BEFORE it trusts any field, and the
   * user id and event id are both inside the signed material - so a cookie
   * lifted from someone else's browser, or minted for a quieter event, verifies
   * as a forgery and returns null.
   */
  const jar = await cookies();
  const raw = jar.get(admissionCookieName(eventId))?.value;
  if (verifyAdmission(raw, { eventId, userId })) {
    return { allowed: true, reason: "admitted" };
  }

  /**
   * 4. Business already in flight.
   *
   * The expensive check, reached last, and the one that stops the queue from
   * eating its own customers: somebody returning from Stripe with a live hold
   * must never be dumped back into the line. See `hasBusinessInFlight` for why
   * this grants nothing a user could not already do.
   */
  if (await hasBusinessInFlight(userId, eventId)) {
    return { allowed: true, reason: "in_flight" };
  }

  return { allowed: false, reason: "no_admission" };
}

/** Where a refused visitor should be sent. */
export function gateRedirect(eventId: string, verdict: GateVerdict): string {
  const lobby = `/events/${eventId}/queue`;
  return verdict.allowed || verdict.reason === "no_admission"
    ? lobby
    : `/login?next=${encodeURIComponent(lobby)}`;
}

/**
 * Put a freshly signed pass on the response.
 *
 * ── THE COOKIE ATTRIBUTES ARE ALL LOAD-BEARING ─────────────────────────────
 * `httpOnly` - script cannot read it, so an XSS bug cannot exfiltrate a pass.
 *   It also cannot be WRITTEN from script, which is what makes "edit
 *   localStorage to skip the queue" impossible rather than merely difficult.
 *
 * `sameSite: "lax"` and NOT "strict", which is the interesting one. Strict
 *   withholds the cookie on any cross-site navigation - including the top-level
 *   GET that brings a user back from Stripe Checkout. Under "strict" that
 *   return would arrive with no pass, and the gate would send a buyer who had
 *   just paid into a waiting room. Lax sends cookies on top-level navigations
 *   and withholds them on cross-site subrequests, which is exactly the shape of
 *   this flow. There is nothing to protect against CSRF here anyway: the pass
 *   authorises nothing a forged request could usefully do.
 *
 * `secure` in production only - `http://localhost` would silently drop a Secure
 *   cookie and the whole feature would appear broken locally for no visible
 *   reason.
 *
 * `expires` from the token's own expiry, so the browser forgets it at the same
 *   instant the signature stops verifying. The expiry inside the signature is
 *   the one that decides; this just stops the browser sending a corpse.
 *
 * Returns false when signing is unconfigured, which the caller must treat as
 * "the queue is off", never as "let them through unsigned".
 */
export function issueAdmission(
  response: NextResponse,
  eventId: string,
  userId: string,
): boolean {
  const pass = signAdmission(eventId, userId);
  if (!pass) return false;

  response.cookies.set({
    name: admissionCookieName(eventId),
    value: pass.value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: pass.expiresAt,
  });
  return true;
}
