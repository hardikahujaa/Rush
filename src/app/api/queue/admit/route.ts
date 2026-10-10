import { NextResponse } from "next/server";

import { isAdmitted } from "@/lib/queue";
import { prepareQueueRequest } from "@/lib/queue-api";
import { fail, queueRunning } from "@/lib/queue-response";
import { issueAdmission } from "@/lib/queue-gate";

/**
 * POST /api/queue/admit - re-issue a pass to someone already through.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * It does NOT admit anybody. It cannot: the only thing that moves a user from
 * `:waiting` into `:admitted` is the Lua script, which checks capacity in the
 * same atomic step. This endpoint calls `isAdmitted`, a plain ZSCORE, and
 * refuses anyone who is not already in that set.
 *
 * That restriction is the entire security property. If this endpoint could
 * admit, it would be a second door onto the seat map with no capacity check
 * behind it - the exact bypass the task is about. So the name is slightly
 * misleading and the behaviour is not: it issues a pass for an admission that
 * already exists.
 *
 * ── WHY IT EXISTS AT ALL ───────────────────────────────────────────────────
 * The admission lives in two places: a row in Redis, and a signed cookie in one
 * browser. Those can separate, and when they do the user is stuck - counted
 * against capacity, holding a slot, and refused at the gate:
 *
 *   - they cleared site data, or are in a private window that just closed;
 *   - they opened the link in a different browser, or a messaging app's in-app
 *     browser handed off to the system one;
 *   - they were admitted on their phone and are now on their laptop.
 *
 * Without this, the only fix is to wait twenty minutes for the slot to expire
 * and queue again - a penalty for something that is not their fault. With it,
 * the lobby recovers in one request.
 *
 * It is safe precisely because the Redis set is the authority and the cookie is
 * only a cached, signed assertion of it. Re-deriving a cache from its source is
 * not a privilege escalation.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const prepared = await prepareQueueRequest(request, body);
  if (!prepared.ok) return prepared.response;

  const { ctx } = prepared;

  /* No drop in progress, so the gate is open anyway and there is no pass to
     re-issue. */
  if (!queueRunning(ctx.event)) {
    return NextResponse.json({ state: "open" });
  }

  const admitted = await isAdmitted(ctx.event.id, ctx.userId);

  /**
   * Redis did not answer.
   *
   * 503 and no pass, which is the opposite of what the polling endpoint does
   * on the same failure - and deliberately so. The poll's fail-open keeps
   * ticket sales alive when Redis dies, and it is reached by a user who is
   * genuinely waiting. This endpoint is a cache-recovery convenience: failing
   * it open would mean "Redis is down" became "anyone may mint a pass", which
   * is a bypass dressed as resilience. The lobby's own polling will fail open
   * a second later if that is really what is happening.
   */
  if (admitted === null) {
    return fail(503, "QUEUE_UNAVAILABLE", "Could not confirm your place. Retrying.");
  }

  /* Not admitted. Deliberately not an error - the honest answer is "you are
     still in the line", and the lobby simply carries on polling. */
  if (!admitted) {
    return NextResponse.json({ state: "waiting" }, { status: 409 });
  }

  const response = NextResponse.json({ state: "admitted", degraded: false });
  if (!issueAdmission(response, ctx.event.id, ctx.userId)) {
    return fail(503, "QUEUE_UNCONFIGURED", "The waiting room is not available.");
  }
  return response;
}
