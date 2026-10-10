import { NextResponse } from "next/server";

import { joinQueue } from "@/lib/queue";
import { prepareQueueRequest } from "@/lib/queue-api";
import { fail, queueRunning, respondToPosition } from "@/lib/queue-response";

/**
 * POST /api/queue/join - take a place in line.
 *
 * ── WHY POST AND NOT GET ───────────────────────────────────────────────────
 * It writes: an INCR and a ZADD. A GET that mutates would be fetched by link
 * prefetchers, browser previews and crawlers, so merely hovering a link to the
 * lobby would enter people into queues they never visited.
 *
 * ── IDEMPOTENT ANYWAY ──────────────────────────────────────────────────────
 * `ZADD NX` means calling this twice does not move you. A refresh, a double
 * click, two tabs and a retried request all find the place already held - which
 * matters, because sending a refresh to the back of the line would punish the
 * one thing an anxious person waiting for tickets is guaranteed to do.
 *
 * ── ON CACHING ─────────────────────────────────────────────────────────────
 * Reads Supabase session cookies and sets an admission cookie, so it must never
 * be cached: a cached response carrying either would hand one visitor's session
 * or pass to the next. POST handlers are dynamic by default; the rule is simply
 * never to opt out.
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

  /**
   * No drop in progress - so there is nothing to queue for.
   *
   * Reported as `open` rather than as an error, because the user did nothing
   * wrong and the correct next step is to walk straight onto the seat map. The
   * lobby page redirects there on seeing this, which is also what happens to
   * anyone who bookmarks a lobby and comes back next week.
   *
   * Checked here rather than in the prelude so no queue key is ever created for
   * an event outside its window.
   */
  if (!queueRunning(ctx.event)) {
    return NextResponse.json({ state: "open" });
  }

  return respondToPosition(await joinQueue(ctx.event.id, ctx.userId), ctx);
}
