/**
 * T32 verification — the QR endpoint and the confirmation email.
 *
 *   npm run email-test          (dev server must be running)
 *
 * Renders the real template and fetches the real endpoint. No email is sent:
 * delivery belongs to Resend and asserting it would be testing their service,
 * not ours. `npm run email-preview -- <you@example.com>` is the send path.
 *
 * READ-ONLY. Creates nothing and modifies nothing.
 */
import { createRequire } from "node:module";

/**
 * ── WHY `server-only` IS NEUTRALISED HERE ─────────────────────────────────
 * Every other test script runs with `--conditions=react-server`, which makes
 * `server-only` resolve to a harmless stub. This one cannot: rendering the email
 * needs `@react-email/components`, which reaches `react-dom/server` - and that
 * module deliberately throws under the `react-server` condition.
 *
 * So the condition is off and `server-only` is pre-seeded into the require cache
 * as an empty module instead, before anything that imports it is loaded. The
 * guard exists to stop a CLIENT BUNDLE pulling in server code; a Node test
 * process is neither, and this is the one place where defeating it is correct
 * rather than convenient.
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
const { encodeTicketPayload, PAYLOAD_CHARS } = await import("../src/lib/ticket-crypto");
const { isEmailConfigured } = await import("../src/lib/email");

const BASE = process.env.RUSH_BASE_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log(`\n  Resend configured: ${isEmailConfigured ? "yes" : "no"}`);

  /* ── a real paid order with tickets ───────────────────────────────────── */
  const [candidate] = await db
    .select({ orderId: orders.id })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(
      sql`${orders.status} = 'paid'
          and exists (select 1 from ${tickets} t where t.order_id = ${orders.id})`,
    )
    .limit(1);
  if (!candidate) throw new Error("no paid order with tickets — run `npm run seed-events`");

  const receipt = await getOrderForReceipt(candidate.orderId);
  if (!receipt) throw new Error("getOrderForReceipt returned null");

  console.log(`  Order            : ${receipt.orderId}`);
  console.log(`  Seats            : ${receipt.seats.length}\n`);

  /* ── 1. the receipt query ─────────────────────────────────────────────── */
  console.log("1. getOrderForReceipt");
  check("returns the buyer's email to send to", Boolean(receipt.buyerEmail?.includes("@")));
  check("returns the event and venue", Boolean(receipt.eventTitle && receipt.venueName));
  check("returns at least one seat", receipt.seats.length > 0);
  check(
    "every seat carries a ticketId (the QR is built from it)",
    receipt.seats.every((s) => s.ticketId !== null),
    "a paid order has a seat with no ticket",
  );
  check(
    "the total equals the sum of the seat lines",
    receipt.seats.reduce((n, s) => n + s.priceCents, 0) === receipt.totalCents,
  );

  /* ── 2. the QR endpoint ───────────────────────────────────────────────── */
  console.log("\n2. GET /api/tickets/qr/[code].png");
  const payload = encodeTicketPayload({
    ticketId: receipt.seats[0].ticketId!,
    orderId: receipt.orderId,
    seatId: receipt.seats[0].seatId,
  });
  check(`the payload is ${PAYLOAD_CHARS} chars`, payload.length === PAYLOAD_CHARS);

  const res = await fetch(`${BASE}/api/tickets/qr/${payload}.png`);
  check("answers 200", res.status === 200, `${res.status}`);
  check(
    "Content-Type is image/png",
    res.headers.get("content-type") === "image/png",
    res.headers.get("content-type") ?? "none",
  );

  const cache = res.headers.get("cache-control") ?? "";
  check("cached immutably for a year", cache.includes("immutable") && cache.includes("31536000"), cache);
  check("declares nosniff", res.headers.get("x-content-type-options") === "nosniff");

  const bytes = Buffer.from(await res.arrayBuffer());
  check(
    "the body is a real PNG (magic bytes)",
    bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    bytes.subarray(0, 8).toString("hex"),
  );
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  check("360x360, big enough to scan off a screen", width === 360 && height === 360, `${width}x${height}`);
  console.log(`      ↳ ${bytes.length} bytes`);

  /* Determinism matters: the URL is cached `immutable`, so the same code must
     always produce the same image or a cached copy would eventually be wrong. */
  const again = Buffer.from(await (await fetch(`${BASE}/api/tickets/qr/${payload}.png`)).arrayBuffer());
  check("the same code renders byte-identical output", bytes.equals(again));

  /* ── 3. the endpoint refuses anything that is not a payload ───────────── */
  console.log("\n3. Malformed codes (must not render)");
  for (const [label, code] of [
    ["too short", payload.slice(0, 40)],
    ["too long", payload + "AAAA"],
    ["illegal character", payload.slice(0, 43) + "!"],
    ["base64 padding", payload.slice(0, 42) + "=="],
    ["an arbitrary string", "hello-world-not-a-ticket-payload-at-all-xxxx"],
  ] as [string, string][]) {
    const r = await fetch(`${BASE}/api/tickets/qr/${encodeURIComponent(code)}.png`);
    check(`${label} -> 404`, r.status === 404, `${r.status}`);
  }
  console.log("      ↳ so it cannot be used as a free QR generator for any string.");

  const noExt = await fetch(`${BASE}/api/tickets/qr/${payload}`);
  check("the .png suffix is optional", noExt.status === 200, `${noExt.status}`);

  /* ── 4. the template ──────────────────────────────────────────────────── */
  console.log("\n4. The rendered email");
  const { render } = await import("@react-email/components");
  const { TicketConfirmationEmail } = await import("../src/emails/ticket-confirmation");
  const { getSiteUrl } = await import("../src/lib/site-url");
  const site = getSiteUrl();

  const seats = receipt.seats
    .filter((s) => s.ticketId)
    .map((s) => {
      const p = encodeTicketPayload({
        ticketId: s.ticketId!,
        orderId: receipt.orderId,
        seatId: s.seatId,
      });
      return {
        sectionName: s.sectionName,
        rowLabel: s.rowLabel,
        seatNo: s.seatNo,
        priceCents: s.priceCents,
        qrUrl: `${site}/api/tickets/qr/${p}.png`,
        ticketRef: s.ticketId!.slice(0, 8),
      };
    });

  const html = await render(
    TicketConfirmationEmail({
      eventTitle: receipt.eventTitle,
      venue: `${receipt.venueName}, ${receipt.venueCity}`,
      startsAt: receipt.startsAt,
      totalCents: receipt.totalCents,
      seats,
      orderRef: receipt.orderId.slice(0, 8),
      ticketsUrl: `${site}/tickets`,
    }),
  );

  check("renders without throwing", html.length > 0);
  check("names the event", html.includes(receipt.eventTitle));
  check("names the venue", html.includes(receipt.venueName));
  /**
   * Matched against the rendered TEXT, not the raw markup.
   *
   * React's server renderer inserts `<!-- -->` between adjacent text nodes, so
   * `Row {rowLabel}` ships as `Row <!-- -->E<!-- -->`. Asserting on
   * `html.includes("Row E")` therefore fails against a perfectly correct
   * template - which is exactly what it did on the first run of this script.
   * Stripping the markers tests what the recipient actually reads.
   */
  const text = html.replace(/<!--\s*-->/g, "").replace(/<[^>]+>/g, " ");

  check(
    "lists every seat (section, row and number)",
    seats.every(
      (s) =>
        text.includes(s.sectionName) &&
        text.includes(`Row ${s.rowLabel}`) &&
        text.includes(`Seat ${s.seatNo}`),
    ),
    "a seat is missing from the rendered text",
  );
  check(
    "shows one QR img per seat",
    seats.every((s) => html.includes(s.qrUrl)),
    "a seat is missing its QR url",
  );
  check(
    "every QR url is ABSOLUTE (a mail client has no origin)",
    seats.every((s) => s.qrUrl.startsWith("http")),
  );
  check("links to the tickets page", html.includes(`${site}/tickets`));
  check(
    "every QR img has alt text naming the seat",
    seats.every((s) =>
      html.includes(`row ${s.rowLabel}, seat ${s.seatNo}`),
    ),
    "a client with images blocked would show nothing useful",
  );
  check("carries the single-scan warning", /scanned\s*<!-- -->?\s*<strong>once|<strong>once<\/strong>/.test(html) || html.includes("once"));

  /* ── 5. nothing secret leaks into an email that travels in plaintext ─── */
  console.log("\n5. Leak check");
  const qrSecret = process.env.QR_SIGNING_SECRET ?? "";
  const resendKey = process.env.RESEND_API_KEY ?? "";
  check(
    "the signing secret is NOT in the email",
    qrSecret.length > 0 && !html.includes(qrSecret),
  );
  check(
    "the Resend API key is NOT in the email",
    resendKey.length > 0 && !html.includes(resendKey),
  );
  check(
    "no full 64-char qr_signature appears",
    !/[0-9a-f]{64}/.test(html),
  );
  check(
    "the buyer's email address is not embedded in the body",
    !html.includes(receipt.buyerEmail),
    "an email that quotes the recipient's address is a phishing template",
  );

  /* ── 6. table-based layout, not web CSS ──────────────────────────────── */
  console.log("\n6. Email-client compatibility");
  check("uses table layout", html.includes("<table"));
  check("no flexbox", !html.includes("display:flex") && !html.includes("display: flex"));
  check("no CSS grid", !html.includes("display:grid") && !html.includes("display: grid"));
  check(
    "no oklch() — unsupported in every major mail client",
    !html.includes("oklch"),
    "a colour would silently fail to paint",
  );
  check(
    "no CSS custom properties",
    !html.includes("var(--"),
    "mail clients do not resolve them",
  );
  console.log(`      ↳ ${html.length} bytes of HTML`);
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
  .catch((error) => {
    failed++;
    console.error("\n  UNCAUGHT:", error);
  })
  .finally(async () => {
    await closePool();
    console.log("─".repeat(64));
    console.log(failed === 0 ? `PASS — ${passed} checks` : `${failed} FAILED of ${passed + failed}`);
    process.exit(failed === 0 ? 0 : 1);
  });
