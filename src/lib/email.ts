import "server-only";

import { render } from "@react-email/components";
import QRCode from "qrcode";
import { Resend } from "resend";

import type { OrderReceipt } from "@/db/queries/orders";
import { getSiteUrl } from "@/lib/site-url";
import { encodeTicketPayload } from "@/lib/ticket-crypto";
import { TicketConfirmationEmail } from "@/emails/ticket-confirmation";

/**
 * Sending the ticket confirmation (T32).
 *
 * ── UNCONFIGURED IS A SUPPORTED STATE ──────────────────────────────────────
 * Nothing here throws when `RESEND_API_KEY` is missing. It logs once and
 * returns `{ sent: false }`. Same posture as `redis.ts`: a repository that
 * cannot be run without an email provider is a repository nobody can run, and
 * the webhook must never fail because the mail account is not set up.
 *
 * Unlike `redis.ts` there is deliberately NO production throw. A rate limiter
 * that silently does nothing in production is a security hole; an email that
 * silently does nothing is a support ticket. The difference matters: failing
 * the deploy over a missing mail key would take ticket SALES offline to protect
 * a receipt.
 */

const apiKey = process.env.RESEND_API_KEY?.trim();

export const isEmailConfigured = Boolean(apiKey);

const resend = apiKey ? new Resend(apiKey) : null;

/**
 * Resend's shared sender, which works with no DNS setup.
 *
 * It comes with a real constraint worth knowing before wondering why nothing
 * arrived: until a domain is verified in the Resend dashboard, this address can
 * only deliver to the email the Resend account itself was created with.
 * `RESEND_FROM` overrides it once a domain exists.
 */
const FROM = process.env.RESEND_FROM?.trim() || "Rush Tickets <onboarding@resend.dev>";

let warned = false;

export type SendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "no_tickets" | "provider_error" };

/**
 * Email one paid order's tickets to its buyer.
 *
 * ── CALLED EXACTLY ONCE PER ORDER, AND NOT BY ITS OWN DOING ────────────────
 * This function has no idempotency of its own and does not need any. The
 * webhook only reaches it inside the `fulfilled` branch, which the unique index
 * on `webhook_events.stripe_event_id` makes reachable exactly once per event
 * (T28). A Stripe retry or a dashboard resend lands on `replayed` or
 * `already_paid` and never gets here - so "no duplicate emails" is a property
 * inherited from the idempotency gate rather than a second mechanism bolted on.
 */
export async function sendTicketConfirmation(
  order: OrderReceipt,
): Promise<SendResult> {
  if (!resend) {
    if (!warned) {
      warned = true;
      console.warn(
        "[email] RESEND_API_KEY is not set — confirmation emails are disabled. " +
          "Add it to .env.local (and to Vercel before T46) to enable them. " +
          "Tickets are still issued and visible at /tickets.",
      );
    }
    return { sent: false, reason: "not_configured" };
  }

  /* A ticket line with no ticket id cannot produce a QR. That only happens if
     this is called before the webhook issued tickets, which would be a caller
     bug - so it is refused loudly rather than sending a receipt with holes. */
  const lines = order.seats.filter((s) => s.ticketId !== null);
  if (lines.length === 0) {
    console.error(
      `[email] order ${order.orderId} has no issued tickets — refusing to send a receipt.`,
    );
    return { sent: false, reason: "no_tickets" };
  }

  const siteUrl = getSiteUrl();

  /**
   * The payload is generated HERE, on the server, once per ticket.
   *
   * `encodeTicketPayload` reads `QR_SIGNING_SECRET`, so this is the only kind of
   * place it can run. The QR endpoint then only ever renders what it is handed,
   * which is what keeps it free of a database query and free of being an oracle.
   */
  const seats = lines.map((line) => {
    const payload = encodeTicketPayload({
      ticketId: line.ticketId!,
      orderId: order.orderId,
      seatId: line.seatId,
    });

    return {
      sectionName: line.sectionName,
      rowLabel: line.rowLabel,
      seatNo: line.seatNo,
      priceCents: line.priceCents,
      /* Absolute, because an email client has no origin to resolve against. */
      qrUrl: `${siteUrl}/api/tickets/qr/${payload}.png`,
      ticketRef: line.ticketId!.slice(0, 8),
      payload,
    };
  });

  /**
   * ── THE SAME QR, ALSO ATTACHED ───────────────────────────────────────────
   * The `<img>` is the primary presentation and is what the brief asked for.
   * The attachments exist because of two things that will otherwise lose
   * somebody their ticket at a door:
   *
   *   1. **Outlook and many mobile clients block remote images by default.** A
   *      QR that only exists as a remote `<img>` is invisible until the
   *      recipient notices a "show images" bar and taps it.
   *   2. **An attachment works with no signal.** The venue is exactly where a
   *      phone has none, and a remote image cannot be fetched then.
   *
   * ~2.7KB per ticket, at most four per order. Cheap insurance.
   */
  const attachments = await Promise.all(
    seats.map(async (seat) => ({
      filename: `ticket-${seat.sectionName.toLowerCase()}-${seat.rowLabel}${seat.seatNo}.png`,
      content: (
        await QRCode.toBuffer(seat.payload, {
          type: "png",
          errorCorrectionLevel: "Q",
          margin: 2,
          width: 360,
          color: { dark: "#000000ff", light: "#ffffffff" },
        })
      ).toString("base64"),
    })),
  );

  const when = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(order.startsAt);

  const element = TicketConfirmationEmail({
    eventTitle: order.eventTitle,
    venue: `${order.venueName}, ${order.venueCity}`,
    startsAt: order.startsAt,
    totalCents: order.totalCents,
    seats,
    orderRef: order.orderId.slice(0, 8),
    ticketsUrl: `${siteUrl}/tickets`,
  });

  /**
   * ── RENDERED HERE, NOT HANDED TO RESEND AS `react:` ──────────────────────
   * Resend's `react` option renders for you, but it does so by dynamically
   * importing `@react-email/render` - which is NOT a standalone package in this
   * install (the renderer ships inside `@react-email/components`). The first
   * attempt used `react:` and failed at runtime with "Failed to render React
   * component. Make sure to install `@react-email/render`".
   *
   * Rendering explicitly removes that resolution entirely, and it buys the
   * plaintext part below, which `react:` gives no way to supply.
   */
  const html = await render(element);

  /**
   * A hand-written plaintext alternative, not a stripped-down copy of the HTML.
   *
   * Two reasons it is worth the lines. A message with no `text/plain` part
   * scores worse with spam filters, which matters for something a buyer must
   * actually receive. And plaintext cannot contain a QR at all - so rather than
   * degrading to a list of seats with the useful bit missing, it leads with the
   * link to /tickets, which is where the codes always are.
   */
  const text = [
    `You're going — ${order.eventTitle}`,
    "",
    when,
    `${order.venueName}, ${order.venueCity}`,
    "",
    `${lines.length} ${lines.length === 1 ? "ticket" : "tickets"}:`,
    ...seats.map(
      (s) =>
        `  - ${s.sectionName}, Row ${s.rowLabel}, Seat ${s.seatNo} — ${(s.priceCents / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}`,
    ),
    "",
    `Total paid: ${(order.totalCents / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}`,
    `Order #${order.orderId.slice(0, 8)}`,
    "",
    `Your QR codes are attached to this email, and always available at:`,
    `${siteUrl}/tickets`,
    "",
    `Each code is signed and can be scanned once. Never share the image —`,
    `whoever is scanned first is let in, and the ticket is then refused for`,
    `everyone else, including you.`,
  ].join("\n");

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: order.buyerEmail,
      subject: `Your ${lines.length === 1 ? "ticket" : `${lines.length} tickets`} for ${order.eventTitle}`,
      html,
      text,
      attachments,
    });

    /* Resend reports failures in the response body, not by throwing, so an
       un-inspected `error` field is a send that silently did nothing. */
    if (error) {
      console.error(
        `[email] Resend refused order ${order.orderId} for ${order.buyerEmail}:`,
        error,
      );
      return { sent: false, reason: "provider_error" };
    }

    console.log(
      `[email] sent ${lines.length} ticket(s) for order ${order.orderId} to ${order.buyerEmail} (id ${data?.id ?? "?"})`,
    );
    return { sent: true, id: data?.id ?? null };
  } catch (error) {
    console.error(`[email] send threw for order ${order.orderId}:`, error);
    return { sent: false, reason: "provider_error" };
  }
}
