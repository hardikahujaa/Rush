import { NextResponse } from "next/server";

import { releaseHolds } from "@/db/queries/holds";
import { getCurrentUser } from "@/lib/auth";
import { limitReleases } from "@/lib/rate-limit";
import { getVerifiedClaims } from "@/lib/supabase/server";
import { releaseHoldSchema } from "@/lib/validation/release";

/**
 * POST /api/holds/release - hand seats back before the timer runs out.
 *
 * ── THE AUTHORISATION RULE LIVES IN SQL, NOT HERE ──────────────────────────
 * There is no "is this hold mine?" check in this file, and that is deliberate.
 * `releaseHolds` puts `user_id = $me` inside the UPDATE's WHERE clause, so a row
 * belonging to somebody else simply does not match. No branch to forget, no gap
 * between reading and writing for a concurrent request to slip through, and no
 * way for a future edit to this route to accidentally bypass it.
 *
 * The strongest version of an authorisation rule is one the database applies,
 * not one the application remembers to.
 *
 * ── WHY RELEASING NOTHING IS STILL A 200 ───────────────────────────────────
 * Releasing seats you already released, or whose hold expired while the request
 * was in flight, updates nothing and returns `released: 0`. The caller's intent
 * - "I do not want these" - is satisfied either way. Answering 404 on a retry
 * after a dropped connection would report failure for something that succeeded.
 */

function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/** Same identity rule as POST /api/holds: verified JWT first, IP as fallback. */
async function identify(request: Request): Promise<string> {
  const claims = await getVerifiedClaims();
  if (claims?.sub) return `user:${claims.sub}`;

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip ? `ip:${ip}` : "anonymous";
}

export async function POST(request: Request) {
  /* Rate limit first, on its own budget - see limitReleases. Before any
     Postgres work, for the same reason as the hold endpoint. */
  const verdict = await limitReleases(await identify(request));

  if (!verdict.success) {
    const retryAfter = Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please wait a moment.",
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
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return fail(401, "UNAUTHENTICATED", "Sign in to release seats.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const parsed = releaseHoldSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Name the seat ids to release.",
      parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  }

  try {
    const result = await releaseHolds({
      userId: user.id,
      seatIds: parsed.data.seatIds,
    });

    return NextResponse.json(
      {
        released: result.released.length,
        seatIds: result.released,
        statusRepaired: result.statusRepaired,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[holds/release] unexpected failure", error);
    // Deliberately vague: internal messages leak schema and query shape.
    return fail(500, "INTERNAL_ERROR", "Could not release those seats.");
  }
}
