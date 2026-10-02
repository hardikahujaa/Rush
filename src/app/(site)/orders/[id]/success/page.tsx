import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SuccessView } from "@/components/orders/success-view";
import { getOrderForUser } from "@/db/queries/orders";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Order confirmed",
  /* Not indexable, and not just for tidiness: this page is per-user and its URL
     is the order id. Nothing here should ever reach a search result. */
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session_id?: string }>;
};

/**
 * /orders/[id]/success - where Stripe sends the buyer after paying.
 *
 * ── AUTHORISATION IS TWO LAYERS, BOTH REQUIRED ─────────────────────────────
 *   1. `src/proxy.ts` now matches `/orders` and bounces a signed-out visitor to
 *      `/login?next=…` before this file runs. Fast, optimistic, no DB query.
 *   2. `requireUser()` here, then `getOrderForUser` - which carries
 *      `user_id = $me` in its own WHERE clause. This is the layer that actually
 *      enforces the rule: it runs inside the thing being protected, so a
 *      matcher typo cannot route around it.
 *
 * A signed-in stranger with the link gets `notFound()`, identical to a bad id.
 * That is deliberate - a 403 would confirm the order exists, and the id is the
 * only thing in the URL.
 *
 * ── WHY `session_id` IS NOT TRUSTED FOR ANYTHING ───────────────────────────
 * `success_url` carries `?session_id={CHECKOUT_SESSION_ID}` because Stripe
 * offers it, and it is tempting to treat it as proof of payment. It is not:
 * it is a query parameter, so the browser controls it, and it is NOT part of
 * any signature. Authorisation comes from the session cookie and the ownership
 * clause; payment status comes from the webhook. The parameter is read only so
 * Next does not warn about an unused prop, and is never used to decide
 * anything.
 */
export default async function OrderSuccessPage({ params, searchParams }: Props) {
  /* Both are Promises in Next.js 16 - synchronous access was removed in 16. */
  const { id } = await params;
  await searchParams;

  const user = await requireUser();
  const order = await getOrderForUser(id, user.id);

  if (!order) notFound();

  return <SuccessView order={order} />;
}
