import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { resetDemoActivity } from "@/db/queries/demo";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/demo/reset - undo everything a rehearsal did, in one call.
 *
 * ── TWO WAYS IN, BECAUSE THE BRIEF ASKS FOR BOTH ────────────────────────────
 * The floating "Reset demo" button (an organizer, already signed in, mid
 * rehearsal) and a bearer secret (typed once from a terminal thirty seconds
 * before walking on stage, no browser session needed) are different callers
 * with different constraints, so this accepts EITHER:
 *   - a verified session whose role is 'organizer', same check every other
 *     organizer-only route in this app makes, or
 *   - `Authorization: Bearer <DEMO_RESET_SECRET>`, checked the same
 *     fail-closed, constant-time way `/api/cron/cleanup` checks `CRON_SECRET`
 *     - an unset secret authenticates nobody, never "Bearer undefined".
 *
 * ── WHY NOT JUST THE ROLE CHECK ─────────────────────────────────────────────
 * Needing to be logged in as the demo organizer to reset the demo is exactly
 * backwards thirty seconds before a presentation starts, or in CI, where
 * nobody is signed in at all. The secret exists for those moments.
 *
 * ── THIS ROUTE IS DELIBERATELY DESTRUCTIVE, AND DELIBERATELY NOT
 *    ENVIRONMENT-GATED ──────────────────────────────────────────────────────
 * `resetDemoActivity` hard-deletes every real order (and everything that
 * cascades from it) and releases every live hold. That is the whole point -
 * "without the seats already being sold" means gone, not soft-released. It is
 * not restricted to non-production, because for a project whose only
 * deployment IS the demo environment, production is exactly where this needs
 * to run. The secret and the role check are the protection the brief asked
 * for; there is no third gate layered on top of what was actually requested.
 */

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function secretMatches(header: string | null): boolean {
  const secret = process.env.DEMO_RESET_SECRET;
  if (!secret) return false; // fail closed, same as CRON_SECRET
  if (!header?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  const bySecret = secretMatches(request.headers.get("authorization"));

  if (!bySecret) {
    const user = await getCurrentUser();
    if (!user) return fail(401, "UNAUTHENTICATED", "Sign in as an organizer to reset the demo.");
    if (user.role !== "organizer") {
      return fail(403, "FORBIDDEN", "Only organizers can reset the demo.");
    }
  }

  try {
    const result = await resetDemoActivity();

    console.log(
      `[demo/reset] cleared ${result.ordersCleared} order(s), released ` +
        `${result.holdsReleased} hold(s), repaired ${result.seatsRepaired} seat(s).`,
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[demo/reset] failed", error);
    return fail(500, "INTERNAL_ERROR", "Could not reset the demo.");
  }
}
