import "server-only";

import Stripe from "stripe";

/**
 * The Stripe client (T26).
 *
 * ── WHAT A CHECKOUT SESSION IS ──────────────────────────────────────────────
 * We never build a payment form ourselves. `stripe.checkout.sessions.create()`
 * asks Stripe to hand back a URL for a page Stripe itself hosts - we redirect
 * the browser there, Stripe collects the card, and Stripe tells us the outcome
 * afterwards via a webhook (T28). The card number, expiry and CVC never pass
 * through our server or even our frontend's JavaScript at any point.
 *
 * That is not a convenience - it is what keeps this app out of PCI DSS scope.
 * A server that touches raw card data has to prove compliance with a long list
 * of rules about how that data is stored, logged and transmitted. A server
 * that only ever sees a Checkout Session's id and a signed webhook event does
 * not, because it is never in possession of anything a thief could use.
 *
 * ── apiVersion IS PINNED, NOT LEFT IMPLICIT ────────────────────────────────
 * Stripe's API version is a separate thing from this npm package's version.
 * Leaving `apiVersion` unset lets the SDK fall back to whatever it was built
 * against - so a routine `npm update` that bumps a minor version could change
 * response shapes this code relies on without a single line here changing.
 * Writing the string out literally means the wire format is pinned to what was
 * actually read and tested, not to "whatever the installed package happens to
 * default to today."
 */

function required(value: string | undefined, name: string): string {
  if (!value || value.length === 0) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

const secretKey = required(process.env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY");

export const stripe = new Stripe(secretKey, {
  apiVersion: "2026-09-30.endive",
  typescript: true,
});
