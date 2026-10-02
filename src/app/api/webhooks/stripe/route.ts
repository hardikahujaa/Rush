import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  expireCheckoutSession,
  fulfillCheckoutSession,
} from "@/db/queries/webhooks";
import { stripe } from "@/lib/stripe";
import { checkoutMetadataSchema } from "@/lib/validation/webhook";

/**
 * POST /api/webhooks/stripe - the only place an order becomes 'paid'.
 *
 * ── THE STATUS CODE IS THE API ──────────────────────────────────────────────
 * Everything about this handler's correctness comes down to one rule: Stripe
 * retries on any non-2xx, for up to three days, and stops on a 2xx. So the
 * status code is not cosmetic reporting - it is an instruction to Stripe, and
 * it has to distinguish "this will never work, stop asking" from "try me
 * again in a minute".
 *
 *   400  the request is not from Stripe, or has been tampered with. Refused
 *        outright. Stripe's own docs specify 400 here.
 *   500  WE are broken - no signing secret configured, database unreachable,
 *        an unexpected throw. Stripe must retry, because the event is valid
 *        and will succeed once we are fixed.
 *   200  handled, OR decided-and-unfulfillable (order missing, amounts
 *        disagree, already paid, event type we do not care about). Anything
 *        a retry cannot change answers 200, with a loud log where a human
 *        needs to look.
 *
 * The 500-vs-200 line is the one that bites: answer 200 on a transient
 * database blip and a real payment is silently dropped forever. Answer 500 on
 * a permanently malformed event and Stripe hammers the endpoint for three
 * days. `src/db/queries/webhooks.ts` encodes the same split as throw-vs-return.
 *
 * ── WHY THERE IS NO RATE LIMIT ON THIS ROUTE ────────────────────────────────
 * Every other POST in this app has one. This one deliberately does not. Legit
 * Stripe traffic is bursty by nature - a drop selling 200 seats produces 200
 * webhooks in a few seconds - and shedding those would turn into retries,
 * which arrive as MORE traffic later. A limiter here would amplify the load it
 * was meant to damp.
 *
 * What protects it instead is that an unsigned request costs almost nothing: no
 * database connection is opened, no query runs, nothing is read, until the HMAC
 * has been verified. A flood of forged payloads buys an attacker one HMAC
 * computation each and a 400.
 *
 * ── NO AUTH, AND NO COOKIES ─────────────────────────────────────────────────
 * Stripe cannot log in. The signature IS the authentication, and it is strictly
 * stronger than a session: it proves both origin and that the bytes are
 * unmodified. This route never touches `cookies()`, so the project's
 * "never cache a route that reads Supabase cookies" rule has nothing to bite
 * on - and POST handlers are dynamic by default regardless.
 */

/* ── logging ────────────────────────────────────────────────────────────── */

/**
 * The outcomes a person has to go looking for, separated from the routine ones.
 *
 * A webhook that quietly returns 200 on a payment it could not fulfil is
 * indistinguishable from one that worked, which is the worst possible
 * combination: the customer has been charged and nothing anywhere says so.
 * These four lines are the alert surface until Sentry lands in T45.
 */
function logIncident(kind: string, detail: Record<string, unknown>) {
  console.error(`[stripe-webhook] INCIDENT ${kind}`, JSON.stringify(detail));
}

/* ── the raw body ───────────────────────────────────────────────────────── */

/**
 * Read the body as TEXT, never as JSON.
 *
 * The signature is an HMAC over the exact bytes Stripe sent. `request.json()`
 * parses and discards them, and re-serialising the object afterwards will not
 * reproduce them - key order, whitespace and number formatting all differ - so
 * verification would fail on every genuine request. The App Router hands over
 * the untouched body here with no configuration; the `bodyParser: false` dance
 * that older guides describe belongs to the Pages Router and does not apply.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    // Not from Stripe. No point retrying something that was never signed.
    return NextResponse.json(
      { error: { code: "MISSING_SIGNATURE", message: "No stripe-signature header." } },
      { status: 400 },
    );
  }

  /**
   * The secret, failing CLOSED when absent - the T25 lesson, restated.
   *
   * T25 found that `` `Bearer ${process.env.CRON_SECRET}` `` collapses to the
   * literal string "Bearer undefined" when the variable is unset, so anyone
   * sending exactly that authenticated. The same shape of bug is available
   * here: pass an empty secret to `constructEventAsync` and it throws, which
   * LOOKS safe, but it is safe by accident rather than by decision. Checking
   * explicitly makes it a decision, and - importantly - lets this answer 500
   * rather than 400, so a genuine event is retried after the variable is set
   * instead of being discarded as a bad signature.
   */
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logIncident("MISSING_WEBHOOK_SECRET", {
      hint:
        "STRIPE_WEBHOOK_SECRET is not set, so no event can be verified. " +
        "Returning 500 so Stripe retries once it is configured. Note the " +
        "production endpoint secret differs from the Stripe CLI one.",
    });
    return NextResponse.json(
      { error: { code: "NOT_CONFIGURED", message: "Webhook is not configured." } },
      { status: 500 },
    );
  }

  const rawBody = await request.text();

  /* ── 1. VERIFY THE SIGNATURE, BEFORE ANYTHING ELSE ─────────────────────
   *
   * `constructEventAsync` rather than `constructEvent`: the async form uses the
   * WebCrypto-based provider, so this same code works unchanged if the route
   * is ever moved to a runtime without node:crypto. The sync version would
   * throw there, at runtime, in production.
   *
   * This also enforces a timestamp tolerance (Stripe's default, 300s), which
   * is what stops a REPLAY ATTACK: an attacker who captures a valid signed
   * payload off the wire cannot resend it tomorrow, because the timestamp is
   * part of the signed material and will be outside the window.
   */
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (error) {
    /* Deliberately terse to the caller, detailed in the log. Telling an
       unauthenticated caller WHY their signature failed helps them iterate. */
    console.warn(
      "[stripe-webhook] signature verification failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Signature verification failed." } },
      { status: 400 },
    );
  }

  /* ── 2. ONLY THE EVENTS THIS APP ACTS ON ──────────────────────────────
   *
   * Everything else is acknowledged and dropped. A Stripe account emits far
   * more than a ticketing app cares about, and answering non-2xx to an event
   * we simply do not handle would have Stripe retrying it for three days.
   */
  const handled = [
    "checkout.session.completed",
    "checkout.session.expired",
    /**
     * The async pair cannot fire today - this account is card-only, and a card
     * either authorises during Checkout or does not. They are wired anyway
     * because enabling UPI, a bank debit or any delayed method is a DASHBOARD
     * toggle, not a code change: the day somebody flips it, a successful
     * delayed payment would otherwise arrive here, be acknowledged, and never
     * issue a ticket. One case label now is cheaper than that bug later.
     */
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ];

  if (!handled.includes(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type }, { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  /* ── 3. VALIDATE THE METADATA WE PUT THERE ────────────────────────────
   *
   * Signature-verified means "Stripe sent it", not "it has the shape this
   * handler expects" - a session created by hand in the dashboard, or by an
   * older version of checkout-session.ts, reaches here legitimately signed and
   * without usable metadata. 200 because no retry can add metadata to a
   * session that does not have it.
   */
  const parsed = checkoutMetadataSchema.safeParse(session.metadata ?? {});
  if (!parsed.success) {
    logIncident("UNUSABLE_METADATA", {
      eventId: event.id,
      eventType: event.type,
      sessionId: session.id,
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return NextResponse.json({ received: true, ignored: "bad_metadata" }, { status: 200 });
  }

  const { orderId, seatIds } = parsed.data;

  try {
    /* ── 4a. THE PAYMENT SUCCEEDED ──────────────────────────────────── */
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      /**
       * `checkout.session.completed` DOES NOT MEAN PAID.
       *
       * This is the single easiest way to build a webhook that hands out free
       * tickets, and it is not obvious from the event's name. The event fires
       * when the customer finishes the Checkout flow; for a delayed payment
       * method that is BEFORE the money has actually moved, and
       * `payment_status` comes back 'unpaid' with the real outcome arriving
       * later as `async_payment_succeeded` or `..._failed`.
       *
       * So the event type is not the authority on whether to fulfil -
       * `payment_status` is. 'no_payment_required' is accepted alongside
       * 'paid' because a 100%-discounted order legitimately settles at zero.
       */
      if (
        session.payment_status !== "paid" &&
        session.payment_status !== "no_payment_required"
      ) {
        console.warn(
          `[stripe-webhook] ${event.type} with payment_status=${session.payment_status} ` +
            `for order ${orderId} - not fulfilling, awaiting the async outcome.`,
        );
        return NextResponse.json(
          { received: true, ignored: `payment_status:${session.payment_status}` },
          { status: 200 },
        );
      }

      /* `amount_total` is what Stripe actually collected. Null would mean a
         session shape this handler cannot reason about, so it is refused
         rather than coerced to 0 - which would otherwise sail through the
         amount comparison for a free order. */
      if (session.amount_total === null) {
        logIncident("NULL_AMOUNT_TOTAL", {
          eventId: event.id,
          sessionId: session.id,
          orderId,
        });
        return NextResponse.json({ received: true, ignored: "null_amount" }, { status: 200 });
      }

      const result = await fulfillCheckoutSession({
        stripeEventId: event.id,
        stripeSessionId: session.id,
        orderId,
        seatIds,
        amountTotal: session.amount_total,
      });

      switch (result.outcome) {
        case "fulfilled":
          console.log(
            `[stripe-webhook] order ${result.orderId} paid — ${result.ticketCount} ticket(s), ` +
              `${result.totalCents} paise, ${result.holdsReleased} hold(s) released.`,
          );
          break;

        case "replayed":
          /* The idempotency gate did its job. Not a problem - this is the
             normal, expected consequence of Stripe's retry design. */
          console.log(`[stripe-webhook] event ${event.id} already processed — no-op.`);
          break;

        case "already_paid":
          console.log(
            `[stripe-webhook] order ${result.orderId} was already paid under another event — no-op.`,
          );
          break;

        case "seat_conflict":
          /**
           * MONEY TAKEN, SEAT UNDELIVERABLE. The one outcome that needs a
           * person today. Logged with everything required to find the payment
           * in Stripe and refund it.
           *
           * Deliberately NOT auto-refunded. A refund is a second money
           * movement and needs its own idempotency story - if
           * `stripe.refunds.create()` succeeded and the follow-up write
           * failed, the next retry would refund again. Issuing money back as
           * a side effect of a webhook retry is a worse failure than the one
           * it is cleaning up, so this surfaces for an explicit, audited
           * decision instead.
           */
          logIncident("REFUND_REQUIRED_SEAT_CONFLICT", {
            orderId: result.orderId,
            seatIds: result.seatIds,
            sessionId: session.id,
            paymentIntent:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : (session.payment_intent?.id ?? null),
            amountPaise: session.amount_total,
            action: "Refund this payment in Stripe. Order marked 'failed'.",
          });
          break;

        case "order_not_found":
        case "seats_not_found":
        case "mismatch":
          logIncident("UNFULFILLABLE", {
            eventId: event.id,
            sessionId: session.id,
            orderId,
            result,
          });
          break;
      }

      /* Every branch above is decided - 200 so Stripe stops. The incidents are
         in the log, not in the retry queue. */
      return NextResponse.json({ received: true, outcome: result.outcome }, { status: 200 });
    }

    /* ── 4b. THE SESSION EXPIRED OR THE DELAYED PAYMENT FAILED ─────── */
    const result = await expireCheckoutSession({
      stripeEventId: event.id,
      orderId,
      seatIds,
    });

    if (result.outcome === "expired") {
      console.log(
        `[stripe-webhook] order ${result.orderId} expired — ${result.holdsReleased} hold(s) ` +
          `released, ${result.seatsRepaired} seat status(es) repaired. ` +
          `(Seats were already on sale: expiry is lazy — see T22.)`,
      );
    } else {
      console.log(`[stripe-webhook] expiry for ${orderId}: ${result.outcome} — no-op.`);
    }

    return NextResponse.json({ received: true, outcome: result.outcome }, { status: 200 });
  } catch (error) {
    /**
     * Transient or unknown: the queries deliberately THROW only for failures a
     * retry might fix (a dropped connection, a deadlock, a bug). 500 is the
     * instruction that makes Stripe come back - and because the webhook_events
     * row rolled back with the rest of the transaction, that retry starts from
     * a clean slate rather than being mistaken for a replay.
     */
    console.error(`[stripe-webhook] transient failure on event ${event.id}`, error);
    return NextResponse.json(
      { error: { code: "PROCESSING_FAILED", message: "Could not process the event." } },
      { status: 500 },
    );
  }
}
