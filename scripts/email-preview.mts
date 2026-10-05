/**
 * DEV-ONLY: send the real confirmation email for an existing paid order.
 *
 *   npm run email-preview -- you@example.com        (sends to that address)
 *   npm run email-preview                           (lists candidates)
 *   npm run email-preview -- --html                 (writes the HTML, sends nothing)
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The only production path to this email is a completed Stripe payment, which
 * means `stripe listen`, a card, and a seat hold every time you want to look at
 * the layout. This takes an order that is ALREADY paid and re-sends its
 * receipt, so iterating on the template costs seconds instead of a checkout.
 *
 * It sends the genuine article - same template, same QR payloads, same
 * attachments - so what lands in the inbox is what a buyer gets.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * `server-only` neutralised, for the same reason as in email-test.mts: this
 * script renders the template, which reaches `react-dom/server`, which refuses
 * to load under the `--conditions=react-server` flag that would otherwise stub
 * `server-only` out. The guard exists to keep server code out of a CLIENT
 * BUNDLE; a Node script is neither client nor bundle.
 */
const nodeRequire = createRequire(import.meta.url);
nodeRequire.cache[nodeRequire.resolve("server-only")] = {
  id: "server-only",
  filename: "server-only",
  loaded: true,
  exports: {},
} as never;

const { eq, sql } = await import("drizzle-orm");
const { db } = await import("../src/db");
const { orders, tickets, users } = await import("../src/db/schema");
const { getOrderForReceipt } = await import("../src/db/queries/orders");
const { isEmailConfigured, sendTicketConfirmation } = await import("../src/lib/email");

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("email-preview is a development helper and will not run in production");
  }

  const arg = process.argv[2]?.trim();
  const htmlOnly = arg === "--html";
  const override = htmlOnly ? undefined : arg?.toLowerCase();

  /* A paid order that actually has tickets - without them there is no QR to
     render and the email module refuses to send. */
  const [candidate] = await db
    .select({ orderId: orders.id, email: users.email })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(
      sql`${orders.status} = 'paid'
          and exists (select 1 from ${tickets} t where t.order_id = ${orders.id})`,
    )
    .orderBy(sql`${orders.createdAt} desc`)
    .limit(1);

  if (!candidate) {
    throw new Error("No paid order with tickets found. Run `npm run seed-events` first.");
  }

  const receipt = await getOrderForReceipt(candidate.orderId);
  if (!receipt) throw new Error(`order ${candidate.orderId} disappeared`);

  console.log(`\n  Order   : ${receipt.orderId}`);
  console.log(`  Event   : ${receipt.eventTitle}`);
  console.log(`  Seats   : ${receipt.seats.length}`);
  console.log(`  Total   : Rs ${(receipt.totalCents / 100).toLocaleString("en-IN")}`);
  console.log(`  On file : ${receipt.buyerEmail}`);

  if (htmlOnly) {
    /* Rendered to a file so the markup can be opened in a browser or pasted
       into a client-compatibility checker without sending anything. */
    const { render } = await import("@react-email/components");
    const { TicketConfirmationEmail } = await import("../src/emails/ticket-confirmation");
    const { encodeTicketPayload } = await import("../src/lib/ticket-crypto");
    const { getSiteUrl } = await import("../src/lib/site-url");

    const site = getSiteUrl();
    const html = await render(
      TicketConfirmationEmail({
        eventTitle: receipt.eventTitle,
        venue: `${receipt.venueName}, ${receipt.venueCity}`,
        startsAt: receipt.startsAt,
        totalCents: receipt.totalCents,
        orderRef: receipt.orderId.slice(0, 8),
        ticketsUrl: `${site}/tickets`,
        seats: receipt.seats
          .filter((s) => s.ticketId)
          .map((s) => {
            const payload = encodeTicketPayload({
              ticketId: s.ticketId!,
              orderId: receipt.orderId,
              seatId: s.seatId,
            });
            return {
              sectionName: s.sectionName,
              rowLabel: s.rowLabel,
              seatNo: s.seatNo,
              priceCents: s.priceCents,
              qrUrl: `${site}/api/tickets/qr/${payload}.png`,
              ticketRef: s.ticketId!.slice(0, 8),
            };
          }),
      }),
    );

    const out = "email-preview.html";
    writeFileSync(out, html, "utf8");
    console.log(`\n  Wrote ${out} (${html.length} bytes). Nothing was sent.`);
    console.log(`  Open it in a browser to check the layout.\n`);
    return;
  }

  if (!isEmailConfigured) {
    throw new Error(
      "RESEND_API_KEY is not set in .env.local — nothing to send with.\n" +
        "  Use `npm run email-preview -- --html` to render the template instead.",
    );
  }

  /* Overriding the recipient is the whole point of the flag: the order on file
     belongs to a seeded demo buyer whose inbox does not exist. */
  const target = override ?? receipt.buyerEmail;
  if (override) {
    console.log(`  Sending to : ${override}  (overriding the address on file)`);
  }

  const result = await sendTicketConfirmation({ ...receipt, buyerEmail: target });

  if (result.sent) {
    console.log(`\n  SENT. Resend id ${result.id ?? "(none)"}\n`);
    console.log(`  If it does not arrive:`);
    console.log(`    - Resend only delivers to the address the account was created`);
    console.log(`      with until a domain is verified. Check that first.`);
    console.log(`    - The QR <img> points at ${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"},`);
    console.log(`      which a mail client cannot reach if it is localhost. The`);
    console.log(`      attached PNGs work regardless.\n`);
  } else {
    console.log(`\n  NOT SENT — reason: ${result.reason}\n`);
    process.exitCode = 1;
  }
}

/**
 * Close the Postgres pool before exiting.
 *
 * Without this, `process.exit()` tears the process down while libuv still has
 * the pool's socket handles open, and Windows prints
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` after an otherwise
 * successful run. Harmless, but a script that ends in an assertion failure
 * looks like it broke.
 */
async function closePool() {
  try {
    const { closeDb } = await import("../src/db");
    await closeDb();
  } catch {
    /* Nothing to close, or already closed. */
  }
}

main()
  .then(async () => { await closePool(); process.exit(process.exitCode ?? 0); })
  .catch((error) => {
    console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
