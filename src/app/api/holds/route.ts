import { NextResponse } from "next/server";

import {
  createHold,
  HoldError,
  isDeadlock,
  isLiveHoldViolation,
  type HoldFailure,
} from "@/db/queries/holds";
import { getCurrentUser } from "@/lib/auth";
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

export async function POST(request: Request) {
  /* ── 1. AUTHENTICATE ─────────────────────────────────────────────────── */
  const user = await getCurrentUser();
  if (!user) {
    return fail(401, "UNAUTHENTICATED", "Sign in to hold seats.");
  }

  /* ── 2. VALIDATE ─────────────────────────────────────────────────────── */
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

  /* ── 3. THE TRANSACTION ──────────────────────────────────────────────── */
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
