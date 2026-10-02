import "server-only";

import type { PendingOrder } from "@/db/queries/orders";
import { getSiteUrl } from "@/lib/site-url";
import { stripe } from "@/lib/stripe";

/**
 * Build the Stripe Checkout Session for a pending order.
 *
 * Pulled out of the route so `scripts/checkout-test.ts` can call the exact
 * code that runs in production - not a re-implementation that could quietly
 * drift from it. That matters doubly here: this is where
 * `CHECKOUT_WINDOW_MINUTES`'s 30-minute floor (`createPendingOrder`'s module
 * comment) actually reaches Stripe, and a test that rebuilt this call by hand
 * could pass while the real route used a different value.
 */
export async function buildCheckoutSession(order: PendingOrder, customerEmail: string) {
  const siteUrl = getSiteUrl();
  /* Stripe requires Epoch SECONDS, not milliseconds. This is the SAME instant
     createPendingOrder already extended the holds to - the whole point of
     threading that one value through is that the two systems' timeouts
     cannot drift apart. */
  const expiresAtUnix = Math.floor(order.expiresAt.getTime() / 1000);

  return stripe.checkout.sessions.create({
    mode: "payment",
    /* No `payment_method_types` here - checked directly against the
       installed SDK's types (apiVersion "2026-09-30.endive") rather than
       memory, and it no longer exists on SessionCreateParams. Stripe now
       manages the enabled methods per-account from the Dashboard and shows
       whatever's turned on there dynamically; "card" is on by default, which
       is also the one the project brief tests against with
       4242 4242 4242 4242. `excluded_payment_method_types` exists if a
       method ever needs to be turned off per-session instead. */
    customer_email: customerEmail,
    line_items: order.lineItems.map((item) => ({
      quantity: 1,
      price_data: {
        currency: "inr",
        unit_amount: item.priceCents,
        product_data: {
          name: `${order.eventTitle} — ${item.sectionName} ${item.rowLabel}${item.seatNo}`,
        },
      },
    })),
    metadata: {
      orderId: order.orderId,
      /* A durable, signature-verified record of which seats this order
         covers, independent of whether the holds are still live by the time
         the webhook (T28) reads it back. Up to 4 UUIDs comfortably fits
         Stripe's 500-character metadata value limit. */
      seatIds: order.lineItems.map((item) => item.seatId).join(","),
    },
    success_url: `${siteUrl}/orders/${order.orderId}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/events/${order.eventId}/seats`,
    /* MUST equal the hold extension createPendingOrder already applied - see
       that function's module comment for what drifts apart otherwise. Stripe
       enforces a 30-minute floor on this value; CHECKOUT_WINDOW_MINUTES there
       is set to match it, so this is never silently below the floor. */
    expires_at: expiresAtUnix,
  });
}
