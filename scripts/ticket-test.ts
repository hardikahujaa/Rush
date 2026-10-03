/**
 * T30 verification — the QR codec, its tamper resistance, and the /tickets
 * authorisation boundary.
 *
 *   npm run ticket-test          (dev server must be running)
 *
 * Calls the real `encodeTicketPayload` / `decodeTicketPayload` /
 * `verifyTicketPayload` the page and T31 will call - not reimplementations.
 *
 * The check that matters most is section 2: a QR is a picture of a string, so
 * the only thing standing between a forged payload and a free seat is the HMAC.
 * Every tamper below must be refused.
 *
 * READ-ONLY on real data except for the pending order created in section 5,
 * which is removed in the finally block.
 */
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import { events, holds, orderItems, orders, seats, tickets, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold } from "../src/db/queries/holds";
import { createPendingOrder } from "../src/db/queries/orders";
import { getTicketsForUser } from "../src/db/queries/tickets";
import {
  decodeTicketPayload,
  encodeTicketPayload,
  PAYLOAD_CHARS,
  verifyTicketPayload,
} from "../src/lib/ticket-crypto";

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

const createdOrders: string[] = [];
const touchedSeats: string[] = [];

async function main() {
  /* ── a real, paid, signed ticket from the database ───────────────────── */
  const [real] = await db
    .select({
      ticketId: tickets.id,
      orderId: tickets.orderId,
      seatId: tickets.seatId,
      storedSignature: tickets.qrSignature,
      userId: orders.userId,
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(eq(orders.status, "paid"))
    .limit(1);
  if (!real) throw new Error("no paid ticket in the database");

  const payload = encodeTicketPayload(real);

  console.log(`\n  Ticket  : ${real.ticketId}`);
  console.log(`  Payload : ${payload}`);
  console.log(`  Length  : ${payload.length} chars\n`);

  /* ── 1. THE FORMAT ───────────────────────────────────────────────────── */
  console.log("1. Payload format");
  check(`is exactly ${PAYLOAD_CHARS} characters`, payload.length === PAYLOAD_CHARS, `${payload.length}`);
  check(
    "is base64url only — no +, /, or = padding",
    /^[A-Za-z0-9_-]+$/.test(payload),
    payload,
  );

  const decoded = decodeTicketPayload(payload);
  check("decodes", decoded !== null);
  check(
    "round-trips the ticket id exactly",
    decoded?.ticketId === real.ticketId,
    `${decoded?.ticketId} vs ${real.ticketId}`,
  );
  check("carries a 16-byte tag", decoded?.tag.length === 16, `${decoded?.tag.length}`);

  /* ── 2. TAMPER RESISTANCE — the whole point ──────────────────────────── */
  console.log("\n2. Forgery attempts (each MUST be refused)");

  check(
    "the genuine payload verifies",
    decoded !== null &&
      verifyTicketPayload({
        ticketId: decoded.ticketId,
        orderId: real.orderId,
        seatId: real.seatId,
        tag: decoded.tag,
      }),
    "A VALID TICKET WAS REJECTED",
  );

  /* Flip one character of the tag region. This is the attack a bare-id QR
     has no answer to at all. */
  const flipAt = PAYLOAD_CHARS - 3;
  const flipped =
    payload.slice(0, flipAt) +
    (payload[flipAt] === "A" ? "B" : "A") +
    payload.slice(flipAt + 1);
  const flippedDecoded = decodeTicketPayload(flipped);
  check(
    "a single flipped character in the tag is refused",
    flippedDecoded === null ||
      !verifyTicketPayload({
        ticketId: flippedDecoded.ticketId,
        orderId: real.orderId,
        seatId: real.seatId,
        tag: flippedDecoded.tag,
      }),
    "A TAMPERED TAG VERIFIED",
  );

  /* Present a genuine tag, but claim it belongs to a different ticket - the
     "copy someone else's signature onto my id" attack. */
  const [other] = await db
    .select({ id: tickets.id, orderId: tickets.orderId, seatId: tickets.seatId })
    .from(tickets)
    .where(sql`${tickets.id} <> ${real.ticketId}`)
    .limit(1);

  check(
    "ticket A's tag presented as ticket B is refused",
    decoded !== null &&
      !verifyTicketPayload({
        ticketId: other.id,
        orderId: other.orderId,
        seatId: other.seatId,
        tag: decoded.tag,
      }),
    "A SIGNATURE WAS REUSABLE ACROSS TICKETS",
  );

  /* Right ticket id, but the seat swapped - "upgrade myself to the front row". */
  check(
    "the right tag with a SWAPPED seat id is refused",
    decoded !== null &&
      !verifyTicketPayload({
        ticketId: decoded.ticketId,
        orderId: real.orderId,
        seatId: other.seatId,
        tag: decoded.tag,
      }),
    "A SEAT COULD BE UPGRADED WITHOUT RESIGNING",
  );

  /* A hand-rolled payload for a real ticket, with a guessed tag. */
  const guessed = decodeTicketPayload(
    Buffer.concat([
      Buffer.from([1]),
      Buffer.from(real.ticketId.replace(/-/g, ""), "hex"),
      Buffer.alloc(16, 0),
    ]).toString("base64url"),
  );
  check(
    "a forged payload with a zeroed tag is refused",
    guessed !== null &&
      !verifyTicketPayload({
        ticketId: guessed.ticketId,
        orderId: real.orderId,
        seatId: real.seatId,
        tag: guessed.tag,
      }),
  );

  /* ── 3. malformed input is rejected BEFORE any DB work ──────────────── */
  console.log("\n3. Malformed scans (rejected before a query runs)");
  const garbage: [string, unknown][] = [
    ["empty string", ""],
    ["too short", payload.slice(0, 40)],
    ["too long", payload + "AAAA"],
    ["standard base64 padding", payload.slice(0, 42) + "=="],
    ["illegal character", payload.slice(0, 43) + "!"],
    ["a bare uuid", real.ticketId],
    ["the raw stored signature", real.storedSignature],
    ["a number", 12345],
    ["null", null],
    ["an object", { o: "x", s: "y" }],
  ];
  for (const [label, value] of garbage) {
    check(`${label} -> null`, decodeTicketPayload(value) === null);
  }

  /* An unknown version byte, otherwise perfectly formed. This is what lets the
     format be changed later without old scanners silently misreading it. */
  const futureVersion = Buffer.concat([
    Buffer.from([2]),
    Buffer.from(real.ticketId.replace(/-/g, ""), "hex"),
    Buffer.alloc(16, 7),
  ]).toString("base64url");
  check(
    "a valid-looking payload with version 2 -> null",
    decodeTicketPayload(futureVersion) === null,
    "an unknown format version was accepted",
  );

  /* ── 4. COMPATIBILITY with every ticket that predates T30 ───────────── */
  console.log("\n4. Backward compatibility (the 345 pre-existing tickets)");
  const sample = await db
    .select({
      ticketId: tickets.id,
      orderId: tickets.orderId,
      seatId: tickets.seatId,
      storedSignature: tickets.qrSignature,
    })
    .from(tickets)
    .limit(50);

  const allMatch = sample.every((t) => {
    const d = decodeTicketPayload(encodeTicketPayload(t));
    if (!d) return false;
    /* The payload's tag must BE the first 16 bytes of the signature already
       stored by T28/the seed. If this fails, T30 silently invalidated every
       ticket ever issued. */
    const storedHead = Buffer.from(t.storedSignature, "hex").subarray(0, 16);
    return d.tag.equals(storedHead) && d.ticketId === t.ticketId;
  });
  check(
    `all ${sample.length} sampled tickets encode to their STORED signature`,
    allMatch,
    "T30 INVALIDATED EXISTING TICKETS",
  );

  const allVerify = sample.every((t) => {
    const d = decodeTicketPayload(encodeTicketPayload(t))!;
    return verifyTicketPayload({ ...t, tag: d.tag });
  });
  check("and all of them verify", allVerify);

  /* ── 5. the /tickets query: ownership + paid-only ───────────────────── */
  console.log("\n5. getTicketsForUser — ownership and paid-only");

  const owned = await getTicketsForUser(real.userId);
  const flatOwned = owned.flatMap((g) => g.tickets);
  check("the owner gets their tickets", flatOwned.length > 0, `${flatOwned.length}`);
  check(
    "including the one under test",
    flatOwned.some((t) => t.ticketId === real.ticketId),
  );
  check(
    "every returned ticket's payload verifies",
    flatOwned.every((t) => {
      const d = decodeTicketPayload(encodeTicketPayload(t));
      return d !== null && verifyTicketPayload({ ...t, tag: d.tag });
    }),
  );
  check(
    "grouped by event, each group non-empty",
    owned.length > 0 && owned.every((g) => g.tickets.length > 0 && Boolean(g.eventTitle)),
  );

  const [stranger] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`${users.id} <> ${real.userId} and ${users.role} = 'buyer'`)
    .limit(1);

  const strangerTickets = await getTicketsForUser(stranger.id);
  check(
    "a DIFFERENT user never sees this ticket",
    !strangerTickets.flatMap((g) => g.tickets).some((t) => t.ticketId === real.ticketId),
    "ANOTHER USER'S ENTRY CREDENTIAL WAS READABLE",
  );

  /* A pending order must yield no tickets - the paid-only filter. */
  const [liveEvent] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  const [freshBuyer] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.role} = 'buyer'`)
    .orderBy(sql`${users.email} desc`)
    .limit(1);

  const free = await db.execute<{ id: string }>(sql`
    select st.id from ${seats} st
    where st.event_id = ${liveEvent.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id limit 1
  `);
  touchedSeats.push(free[0].id);
  await createHold({ userId: freshBuyer.id, seatIds: [free[0].id] });
  const pending = await createPendingOrder({
    userId: freshBuyer.id,
    seatIds: [free[0].id],
  });
  createdOrders.push(pending.orderId);

  const afterPending = await getTicketsForUser(freshBuyer.id);
  check(
    "a PENDING order contributes no tickets",
    !afterPending.flatMap((g) => g.tickets).some((t) => t.orderId === pending.orderId),
    "an unpaid order produced a scannable ticket",
  );

  /* ── 6. the route, and the leak check ───────────────────────────────── */
  console.log("\n6. The /tickets route, signed out");
  const page = await fetch(`${BASE}/tickets`, { redirect: "manual" });
  check("redirects 307 rather than rendering", page.status === 307, `${page.status}`);
  const location = page.headers.get("location") ?? "";
  check(
    "to /login with ?next=/tickets",
    location.includes("/login") && location.includes(encodeURIComponent("/tickets")),
    location,
  );

  /* The page is behind auth so its HTML cannot be fetched here, but the thing
     worth asserting is that the payload the component receives does not
     contain the secret or the full signature - which is a property of the
     codec, testable directly. */
  console.log("\n7. Secret containment");
  const secret = process.env.QR_SIGNING_SECRET ?? "";
  check(
    "the payload does not contain the signing secret",
    secret.length > 0 && !payload.includes(secret),
  );
  check(
    "the payload does not contain the full 64-char stored signature",
    !payload.includes(real.storedSignature),
  );
  check(
    "the payload carries only HALF the signature (16 of 32 bytes)",
    decoded !== null &&
      decoded.tag.equals(Buffer.from(real.storedSignature, "hex").subarray(0, 16)) &&
      !decoded.tag.equals(Buffer.from(real.storedSignature, "hex")),
  );
  console.log("      ↳ the browser never receives the full 256-bit signature.");

  /* ── 8. the secret is actually load-bearing ─────────────────────────── */
  console.log("\n8. Is the secret doing anything?");
  const realSecret = process.env.QR_SIGNING_SECRET;
  process.env.QR_SIGNING_SECRET = "a-different-secret-entirely";
  const underWrongSecret =
    decoded !== null &&
    verifyTicketPayload({
      ticketId: decoded.ticketId,
      orderId: real.orderId,
      seatId: real.seatId,
      tag: decoded.tag,
    });
  process.env.QR_SIGNING_SECRET = realSecret;

  check(
    "a valid payload FAILS under a different secret",
    !underWrongSecret,
    "THE SECRET IS NOT ACTUALLY PART OF THE SIGNATURE",
  );
  check(
    "and verifies again once the real secret is restored",
    decoded !== null &&
      verifyTicketPayload({
        ticketId: decoded.ticketId,
        orderId: real.orderId,
        seatId: real.seatId,
        tag: decoded.tag,
      }),
  );
}

async function cleanup() {
  if (createdOrders.length) {
    await db.delete(orderItems).where(inArray(orderItems.orderId, createdOrders));
    await db.delete(orders).where(inArray(orders.id, createdOrders));
  }
  if (touchedSeats.length) {
    await db.delete(holds).where(inArray(holds.seatId, touchedSeats));
    await db.update(seats).set({ status: "available" }).where(inArray(seats.id, touchedSeats));
  }
  console.log(
    `\n  cleanup: ${createdOrders.length} order(s), ${touchedSeats.length} seat(s) restored.`,
  );
}

main()
  .catch((error) => {
    failed++;
    console.error("\n  UNCAUGHT:", error);
  })
  .finally(async () => {
    await cleanup().catch((e) => {
      failed++;
      console.error("  cleanup failed:", e);
    });
    console.log("─".repeat(64));
    console.log(failed === 0 ? `PASS — ${passed} checks` : `${failed} FAILED of ${passed + failed}`);
    process.exit(failed === 0 ? 0 : 1);
  });
