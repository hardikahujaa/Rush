import { NextResponse } from "next/server";

import {
  attachStripeSession,
  createPendingOrder,
  deleteOrphanedPendingOrder,
  OrderError,
  type OrderFailure,
} from "@/db/queries/orders";
import { getCurrentUser } from "@/lib/auth";
import { buildCheckoutSession } from "@/lib/checkout-session";
import { limitCheckout } from "@/lib/rate-limit";
import { getVerifiedClaims } from "@/lib/supabase/server";
import { checkoutSchema } from "@/lib/validation/checkout";

/**
 * POST /api/checkout - turn a live hold into a Stripe Checkout Session.
 *
 * ── WHY THREE PHASES, NOT ONE TRANSACTION ───────────────────────────────────
 * The DB work (verify the holds, compute the total, extend the holds, insert
 * the pending order) is one transaction - see `createPendingOrder`. The call
 * to Stripe happens AFTER it commits, deliberately outside any transaction:
 * holding Postgres row locks open for the duration of a network round trip to
 * a third-party API would block every other request touching these seats for
 * as long as Stripe takes to answer. A slow Stripe response would become a
 * slow seat map for everyone.
 *
 *   1. DB phase   - createPendingOrder (its own transaction, committed)
 *   2. Stripe phase - stripe.checkout.sessions.create (no open transaction)
 *   3. Attach phase - attachStripeSession (one small UPDATE)
 *
 * If step 2 throws, step 1's order is deleted via `deleteOrphanedPendingOrder`
 * and the caller gets a clean 502. The hold extension from step 1 is left in
 * place - it is harmless (the caller still owns those seats) and a retry
 * simply extends it again.
 *
 * ── WHY getCurrentUser AND NOT requireUser ─────────────────────────────────
 * Same reasoning as /api/holds: `requireUser()` redirects, and a fetch() would
 * silently try to parse a login page as JSON. A route handler answers 401.
 *
 * ── ON CACHING ─────────────────────────────────────────────────────────────
 * Reads Supabase session cookies, so - like every other route in this app -
 * it must never be cached. POST handlers are dynamic by default; the rule is
 * simply never to opt out.
 */

function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/** Maps a domain failure onto its HTTP answer, same shape as holds/route.ts. */
function failureResponse(failure: OrderFailure) {
  switch (failure.code) {
    case "SEATS_NOT_FOUND":
      return fail(404, failure.code, "Those seats do not exist.", {
        seatIds: failure.seatIds,
      });

    case "MIXED_EVENTS":
      return fail(
        409,
        failure.code,
        "All seats in one checkout must belong to the same event.",
      );

    case "HOLDS_INVALID":
      /* Named deliberately: the UI can send the buyer back to reselect just
         these seats rather than discarding a selection that may still be
         mostly valid. */
      return fail(
        409,
        failure.code,
        failure.seatIds.length === 1
          ? "Your hold on that seat is no longer valid. Please choose again."
          : "Your hold on some of those seats is no longer valid. Please choose again.",
        { seatIds: failure.seatIds },
      );
  }
}

/** Identical to /api/holds and /api/holds/release: verified JWT sub first,
 *  IP as the fallback for callers about to get a 401 anyway. */
async function identify(request: Request): Promise<string> {
  const claims = await getVerifiedClaims();
  if (claims?.sub) return `user:${claims.sub}`;

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip ? `ip:${ip}` : "anonymous";
}

export async function POST(request: Request) {
  /* ── 1. RATE LIMIT, BEFORE ANY DATABASE OR STRIPE WORK ──────────────────
   * Same position as /api/holds - above auth, so a flood never opens a
   * Postgres connection, let alone reaches the Stripe call below it. */
  const identifier = await identify(request);
  const verdict = await limitCheckout(identifier);

  if (!verdict.success) {
    const retryAfterSeconds = Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many checkout attempts. Please wait a moment.",
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
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
    return fail(401, "UNAUTHENTICATED", "Sign in to check out.");
  }

  /* ── 3. VALIDATE ─────────────────────────────────────────────────────── */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Send between 1 and 4 seat ids.",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }

  /* ── 4. DB PHASE: VERIFY THE HOLDS, OPEN A PENDING ORDER ────────────── */
  let order;
  try {
    order = await createPendingOrder({
      userId: user.id,
      seatIds: parsed.data.seatIds,
    });
  } catch (error) {
    if (error instanceof OrderError) return failureResponse(error.failure);
    console.error("[checkout] unexpected failure creating the order", error);
    return fail(500, "INTERNAL_ERROR", "Could not start checkout.");
  }

  /* ── 5. STRIPE PHASE, DELIBERATELY OUTSIDE ANY DB TRANSACTION ───────── */
  let session;
  try {
    session = await buildCheckoutSession(order, user.email);
  } catch (error) {
    console.error("[checkout] Stripe session creation failed", error);
    /* The pending order from step 4 has no purpose without a session - undo
       it rather than leaving an orphaned row with nothing to attach to. */
    await deleteOrphanedPendingOrder(order.orderId);
    return fail(502, "STRIPE_ERROR", "Could not start checkout. Please try again.");
  }

  if (!session.url) {
    // Should be unreachable for a hosted-page session with no ui_mode override.
    console.error("[checkout] Stripe session has no url", session.id);
    await deleteOrphanedPendingOrder(order.orderId);
    return fail(502, "STRIPE_ERROR", "Could not start checkout. Please try again.");
  }

  /* ── 6. ATTACH PHASE ─────────────────────────────────────────────────── */
  await attachStripeSession(order.orderId, session.id);

  return NextResponse.json(
    {
      orderId: order.orderId,
      url: session.url,
      totalCents: order.totalCents,
      expiresAt: order.expiresAt.toISOString(),
    },
    { status: 200 },
  );
}
