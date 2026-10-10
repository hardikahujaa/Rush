import "server-only";

import { NextResponse } from "next/server";

import { getEventQueueInfo } from "@/db/queries/events";
import { getCurrentUser } from "@/lib/auth";
import { fail, type QueueContext } from "@/lib/queue-response";
import { limitQueue } from "@/lib/rate-limit";
import { getVerifiedClaims } from "@/lib/supabase/server";
import { queueEventSchema } from "@/lib/validation/queue";

/**
 * The shared prelude and response mapping for the three queue endpoints.
 *
 * Every one of them does the same four things before it does its own: rate
 * limit, authenticate, validate, and establish that a queue is actually running
 * for this event. Writing that three times would guarantee the three drift, and
 * the one that drifts is the one an attacker uses - so it is written once here
 * and the route handlers are left with a single line of their own logic each.
 *
 * The RESPONSE half lives in `queue-response.ts`, which deliberately has no
 * dependency on authentication - see the note at the top of that file.
 */

/**
 * Who is being rate limited - resolved WITHOUT touching Postgres.
 *
 * Identical reasoning to `/api/holds`: `getVerifiedClaims()` verifies the JWT
 * signature and hands back `sub` with no database query, which is the whole
 * point of rejecting a flood before a connection is opened. The IP is only a
 * fallback for callers who are about to get a 401 anyway, and it is not trusted
 * for anything else - `x-forwarded-for` is a client-written header everywhere
 * except behind Vercel's edge.
 */
async function identify(request: Request): Promise<string> {
  const claims = await getVerifiedClaims();
  if (claims?.sub) return `user:${claims.sub}`;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip ? `ip:${ip}` : "anonymous";
}

/**
 * Rate limit, authenticate, validate, and confirm a drop is in progress.
 *
 * Returns either a context the caller can use or the response it must return.
 * The discriminated union is deliberate: there is no way to accidentally use a
 * `userId` from a request that failed, because on failure there is no `userId`
 * to use.
 */
export async function prepareQueueRequest(
  request: Request,
  eventIdFrom: unknown,
): Promise<{ ok: true; ctx: QueueContext } | { ok: false; response: NextResponse }> {
  /* ── 1. RATE LIMIT, BEFORE ANY DATABASE WORK ───────────────────────────
     Above authentication on purpose: `getCurrentUser()` queries Postgres, so
     limiting after it would mean a flood still cost a query per request. */
  const verdict = await limitQueue(await identify(request));
  if (!verdict.success) {
    const retryAfter = Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000));
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. The page will keep checking for you.",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "RateLimit-Limit": String(verdict.limit),
            "RateLimit-Remaining": String(verdict.remaining),
            "RateLimit-Reset": String(retryAfter),
          },
        },
      ),
    };
  }

  /* ── 2. AUTHENTICATE ───────────────────────────────────────────────────
     401 rather than a redirect: `requireUser()` throws NEXT_REDIRECT, and a
     fetch() would follow the 307 and try to parse a login page as JSON. */
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: fail(401, "UNAUTHENTICATED", "Sign in to join the queue."),
    };
  }

  /* ── 3. VALIDATE ───────────────────────────────────────────────────────
     Before the id reaches a Redis key template. See validation/queue.ts. */
  const parsed = queueEventSchema.safeParse(eventIdFrom);
  if (!parsed.success) {
    return { ok: false, response: fail(400, "VALIDATION_ERROR", "eventId must be a uuid.") };
  }

  /* ── 4. THE EVENT MUST EXIST ───────────────────────────────────────────
     A well-formed uuid for no event would otherwise create a queue key for a
     drop that does not exist - unbounded, caller-controlled key creation in a
     store billed per key. */
  const event = await getEventQueueInfo(parsed.data.eventId);
  if (!event) {
    return { ok: false, response: fail(404, "EVENT_NOT_FOUND", "No such event.") };
  }

  return { ok: true, ctx: { userId: user.id, event } };
}
