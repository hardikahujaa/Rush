import { NextResponse } from "next/server";

import { getOrderStatusForUser } from "@/db/queries/orders";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/orders/[id]/status - what the success page polls.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * Payment confirmation is ASYNCHRONOUS. Stripe redirects the buyer to the
 * success page the instant they pay, but the webhook that actually marks the
 * order paid and issues the tickets is a separate HTTP request travelling a
 * separate path. The redirect usually wins the race. So the page has to be
 * able to say "we are confirming" and then update itself, rather than
 * rendering "pending" once and looking broken.
 *
 * ── WHY IT DOES NOT FULFIL THE ORDER ITSELF ─────────────────────────────────
 * A tempting shortcut: have this route retrieve the session from Stripe and
 * fulfil it if the webhook has not landed. Deliberately NOT done, and the
 * reason is the whole design of T28. Fulfilment is idempotent because it is
 * keyed on `webhook_events.stripe_event_id`, and a request from the browser
 * has no event id to key on. A second fulfilment path would be a second thing
 * that writes tickets, racing the first, with no shared gate - which is
 * precisely the duplicate-ticket bug the webhook was built to make impossible.
 *
 * One writer, one gate. This route only ever reads.
 *
 * ── CACHING ────────────────────────────────────────────────────────────────
 * This reads Supabase session cookies, so per the project rule it must never
 * be cached - no `revalidate`, no `s-maxage`. A cached response here would be
 * doubly wrong: it carries a `Set-Cookie` session token AND a per-user order
 * status. Route handlers are dynamic by default; the rule is not to opt out.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  /* `params` is a Promise in Next.js 16 - synchronous access was removed. */
  const { id } = await context.params;

  /* 401 rather than a redirect: this is polled by fetch(), which would follow
     a 307 and try to parse a login page as JSON. Same reasoning as /api/holds. */
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in to view this order." } },
      { status: 401 },
    );
  }

  /* Ownership lives in the query's WHERE clause, so "not found" and "not
     yours" are the same answer - see getOrderStatusForUser. 404 for both:
     a 403 would confirm that an order with this id exists. */
  const order = await getOrderStatusForUser(id, user.id);
  if (!order) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Order not found." } },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { status: order.status, ticketCount: order.ticketCount },
    { status: 200 },
  );
}
