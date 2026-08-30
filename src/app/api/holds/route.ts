import { NextResponse } from "next/server";

import {
  createHold,
  HoldError,
  isDeadlock,
  isLiveHoldViolation,
  type HoldFailure,
} from "@/db/queries/holds";
import { getCurrentUser } from "@/lib/auth";
import { limitHolds } from "@/lib/rate-limit";
import { getVerifiedClaims } from "@/lib/supabase/server";
import { createHoldSchema, MAX_SEATS_PER_USER } from "@/lib/validation/holds";

/**
 * POST /api/holds - claim seats for ten minutes.
 *
 * ── WHY getCurrentUser AND NOT requireUser ─────────────────────────────────
 * `requireUser()` calls `redirect()`, which throws NEXT_REDIRECT and turns into
 * a 307 pointing at the login page. That is right for a page and wrong for an
 * API: a fetch() would silently follow the redirect and try to parse an HTML
 * login form as JSON. A route handler has to say 401 and mean it.
 *
 * ── ON CACHING ─────────────────────────────────────────────────────────────
 * This handler reads Supabase session cookies, so it must never be cached - a
 * cached response carrying a Set-Cookie session token would hand one visitor's
 * session to the next. POST handlers are dynamic by default; the rule here is
 * simply never to opt out.
 */

/** Every failure leaves through here, so the shape is identical across codes. */
function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/** Maps a domain failure onto its HTTP answer. One place, so nothing drifts. */
function failureResponse(failure: HoldFailure) {
  switch (failure.code) {
    case "SEATS_NOT_FOUND":
      return fail(404, failure.code, "Those seats do not exist.", {
        seatIds: failure.seatIds,
      });

    case "MIXED_EVENTS":
      return fail(
        409,
        failure.code,
        "All seats in one hold must belong to the same event.",
      );

    case "EVENT_NOT_ON_SALE":
      return fail(
        409,
        failure.code,
        failure.reason === "not_dropped"
          ? "Tickets for this event have not been released yet."
          : "This event is not currently on sale.",
      );

    case "SEATS_UNAVAILABLE":
      /* The seat ids are returned deliberately. Without them the UI can only
         say "something is taken" and leave the user hunting; with them it can
         grey out exactly the seats that went and keep the rest selected. */
      return fail(
        409,
        failure.code,
        failure.seatIds.length === 1
          ? "Someone just took that seat."
          : "Someone just took some of those seats.",
        { seatIds: failure.seatIds },
      );

    case "SEAT_LIMIT_EXCEEDED":
      return fail(
        409,
        failure.code,
        `You can hold at most ${failure.max} seats for this event, and you already hold ${failure.alreadyHeld}.`,
        { alreadyHeld: failure.alreadyHeld, max: failure.max },
      );
  }
}

/**
 * Who is being rate limited - resolved WITHOUT touching Postgres.
 *
 * `getVerifiedClaims()` checks the JWT signature against Supabase's signing keys
 * and hands back `sub`, the user id. It is not `getCurrentUser()`, which also
 * queries the `users` table - and the whole point of this step is to reject a
 * flood before a database connection is ever opened.
 *
 * ── WHY THE USER ID IS PREFERRED OVER THE IP ───────────────────────────────
 * `x-forwarded-for` is a header, and headers are written by clients. Vercel
 * overwrites it at its edge so production is sound, but locally anyone can
 * rotate it and walk straight through an IP-keyed limit.
 *
 * It is also wrong about who "a user" is. On carrier-grade NAT or campus wifi -
 * exactly where this gets demonstrated - hundreds of people share one address,
 * so five requests per ten seconds per IP would lock out a whole lecture hall
 * during a drop. A verified `sub` is one person, always.
 *
 * The IP is kept only as the fallback for callers with no valid token, who are
 * about to receive a 401 anyway; limiting them is about not serving that 401 a
 * thousand times a second.
 */
async function identify(request: Request): Promise<string> {
  const claims = await getVerifiedClaims();
  if (claims?.sub) return `user:${claims.sub}`;

  /* Leftmost entry is the originating client. Everything after it is the proxy
     chain. */
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  if (ip) return `ip:${ip}`;

  /* No token and no forwarded address - a direct local connection. One shared
     bucket is correct here: it is a single caller by definition. */
  return "anonymous";
}

export async function POST(request: Request) {
  /* ── 1. RATE LIMIT, BEFORE ANY DATABASE WORK ─────────────────────────────
   *
   * This sits above authentication deliberately. `getCurrentUser()` on the next
   * line queries Postgres, so putting the limit after it would mean a flood
   * still opened a connection and ran a query per request - protecting the
   * endpoint from nothing that costs anything.
   */
  const identifier = await identify(request);
  const verdict = await limitHolds(identifier);

  if (!verdict.success) {
    const retryAfterSeconds = Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000));

    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "You're clicking too fast! Please wait a moment.",
        },
      },
      {
        status: 429,
        headers: {
          /* The one header a client is obliged to honour. */
          "Retry-After": String(retryAfterSeconds),
          /* IETF draft RateLimit fields - machine-readable detail without
             putting it in the body, where it would break the error envelope. */
          "RateLimit-Limit": String(verdict.limit),
          "RateLimit-Remaining": String(verdict.remaining),
          "RateLimit-Reset": String(retryAfterSeconds),
        },
      },
    );
  }

  /* ── 2. AUTHENTICATE ─────────────────────────────────────────────────── */
  const user = await getCurrentUser();
  if (!user) {
    return fail(401, "UNAUTHENTICATED", "Sign in to hold seats.");
  }

  /* ── 3. VALIDATE ─────────────────────────────────────────────────────── */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // A malformed body is the client's mistake, not a 500.
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const parsed = createHoldSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `Send between 1 and ${MAX_SEATS_PER_USER} seat ids.`,
      parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  }

  /* ── 4. THE TRANSACTION ──────────────────────────────────────────────── */
  try {
    const result = await createHold({
      userId: user.id,
      seatIds: parsed.data.seatIds,
    });

    return NextResponse.json(
      {
        eventId: result.eventId,
        seats: result.seats,
        expiresAt: result.expiresAt.toISOString(),
        totalCents: result.totalCents,
        replayed: result.replayed,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof HoldError) return failureResponse(error.failure);

    /* Layer 2 firing: the partial unique index caught a live hold that the
       availability check somehow missed. That should be impossible given the
       row locks, so it is logged loudly - but the user still gets the honest
       answer, which is that the seat is gone. */
    if (isLiveHoldViolation(error)) {
      console.error("[holds] unique violation reached the index", error);
      return failureResponse({ code: "SEATS_UNAVAILABLE", seatIds: [] });
    }

    /* Should be unreachable: every transaction locks seats in ascending id
       order, so no cycle can form. If this ever fires, the ordering has been
       broken and it needs to be found, not retried into submission. */
    if (isDeadlock(error)) {
      console.error("[holds] DEADLOCK - lock ordering has been broken", error);
      return fail(
        503,
        "DEADLOCK",
        "The system was too busy to complete that. Please try again.",
      );
    }

    console.error("[holds] unexpected failure", error);
    // Deliberately vague: internal messages can leak schema and query shape.
    return fail(500, "INTERNAL_ERROR", "Could not hold those seats.");
  }
}
