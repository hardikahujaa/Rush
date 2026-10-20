import { NextResponse } from "next/server";
import { z } from "zod";

import { getRecentOrders } from "@/db/queries/analytics";
import { getCurrentUser } from "@/lib/auth";

/** `events.id` is a uuid column; see the identical note in orders/[id]/status. */
const eventIdSchema = z.uuid();

/**
 * GET /api/organizer/events/[id]/recent-orders - the dashboard's one polled
 * endpoint.
 *
 * ── WHY THIS IS THE ONLY ONE OF THE SIX READS WITH A ROUTE HANDLER ─────────
 * The other five (`getEventRevenue`, `getSectionSellThrough`,
 * `getSalesOverTime`, `getConversionFunnel`, `getAvgHoldToPurchase`,
 * `getCheckInStats`) are called directly from the dashboard's Server
 * Component on render - CLAUDE.md's "prefer server components" rule, and
 * there is nothing to push client-side when the whole page already re-renders
 * on navigation. This one is different only because the brief specifically
 * asks for a LIVE-updating list, which needs a client-side poll loop - and a
 * poll loop needs something to fetch.
 *
 * ── AUTHORIZATION, THE SAME TWO LAYERS AS EVERY OTHER ROUTE HERE ───────────
 * `getCurrentUser()`, not `requireRole()` - `requireRole` throws
 * `NEXT_REDIRECT` on failure, which turns into a 307 a `fetch()` caller would
 * silently follow and then fail to parse as JSON. Same reasoning as
 * `/api/holds/route.ts`. The role check below is the manual equivalent, kept
 * inline so the response is a real 401/403 rather than a redirect.
 *
 * That only proves the caller is SOME organizer; it does not prove they own
 * THIS event. `getRecentOrders` resolves ownership itself and returns `null`
 * for an event that does not exist or belongs to someone else - this handler
 * turns that `null` into a 404, exactly as `/orders/[id]` does for a
 * stranger's order, so a wrong-organizer probe cannot tell "not yours" apart
 * from "doesn't exist".
 *
 * ── ON CACHING ─────────────────────────────────────────────────────────────
 * Reads Supabase session cookies via `requireRole`, so this must never be
 * cached - no `s-maxage`, no `revalidate`. Route handlers are dynamic by
 * default; the rule is simply not to opt out.
 */

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const parsedId = eventIdSchema.safeParse(eventId);
  if (!parsedId.success) {
    return fail(400, "VALIDATION_ERROR", "Event id must be a uuid.");
  }

  const user = await getCurrentUser();
  if (!user) return fail(401, "UNAUTHENTICATED", "Sign in to view this dashboard.");
  if (user.role !== "organizer") {
    return fail(403, "FORBIDDEN", "Only organizers can view sales dashboards.");
  }

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 10, 1), 25);

  const orders = await getRecentOrders(parsedId.data, user.id, limit);
  if (!orders) {
    return fail(404, "NOT_FOUND", "No such event.");
  }

  return NextResponse.json({
    orders: orders.map((o) => ({
      orderId: o.orderId,
      buyerEmail: o.buyerEmail,
      seatCount: o.seatCount,
      totalCents: o.totalCents,
      createdAt: o.createdAt.toISOString(),
    })),
  });
}
