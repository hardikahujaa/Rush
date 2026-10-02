/**
 * T29 verification — the success page's data and its ownership boundary.
 *
 *   npm run success-test          (dev server must be running)
 *
 * The page itself is a server component behind `requireUser()`, so the thing
 * worth testing is not the markup - it is the rule that decides WHO may read an
 * order. That rule is a WHERE clause in `getOrderForUser`, so this calls the
 * real query the page calls, as a stranger, and checks it returns nothing.
 *
 * An order id is a uuid in a URL. It gets pasted into chats, screenshots and
 * support tickets. If ownership were a branch in the page instead of a clause
 * in the query, this is the test that would catch the day somebody deletes it.
 *
 * SAFE ON REAL DATA — read-only except for the hold/order it creates for the
 * pending-state case, which is removed in the finally block.
 */
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import { events, holds, orderItems, orders, seats, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold } from "../src/db/queries/holds";
import {
  createPendingOrder,
  getOrderForUser,
  getOrderStatusForUser,
} from "../src/db/queries/orders";

const BASE = process.env.RUSH_BASE_URL ?? "http://localhost:3000";
const BOGUS_UUID = "00000000-0000-4000-8000-000000000000";

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
  /* ── a real paid order from the seed, and somebody who does not own it ── */
  const [paid] = await db
    .select({ id: orders.id, userId: orders.userId, totalCents: orders.totalCents })
    .from(orders)
    .where(eq(orders.status, "paid"))
    .limit(1);
  if (!paid) throw new Error("no paid order in the seed");

  const [stranger] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`${users.id} <> ${paid.userId} and ${users.role} = 'buyer'`)
    .limit(1);

  console.log(`\n  Paid order : ${paid.id}`);
  console.log(`  Stranger   : ${stranger.email}\n`);

  /* ── 1. THE OWNER CAN READ IT ────────────────────────────────────────── */
  console.log("1. The owner reads their own order");
  const mine = await getOrderForUser(paid.id, paid.userId);
  check("the order comes back", mine !== null);
  check("with its event and venue joined", Boolean(mine?.eventTitle && mine?.venueName));
  check("with at least one seat line", (mine?.seats.length ?? 0) > 0);
  check(
    "total equals the sum of its seat lines",
    mine !== null && mine.seats.reduce((s, l) => s + l.priceCents, 0) === mine.totalCents,
    `${mine?.totalCents} vs ${mine?.seats.reduce((s, l) => s + l.priceCents, 0)}`,
  );
  check(
    "every seat line carries a ticket id (it is paid)",
    mine !== null && mine.seats.every((l) => l.ticketId !== null),
    "a paid order is missing a ticket",
  );

  /* ── 2. A STRANGER CANNOT ───────────────────────────────────────────── */
  console.log("\n2. A DIFFERENT signed-in user asks for the same order id");
  console.log("   (the whole reason user_id lives in the WHERE clause)");
  const theirs = await getOrderForUser(paid.id, stranger.id);
  check(
    "returns null — not the order",
    theirs === null,
    "ANOTHER USER'S SEATS, PRICES AND TICKET IDS WERE READABLE",
  );

  const theirStatus = await getOrderStatusForUser(paid.id, stranger.id);
  check(
    "the status endpoint's query is scoped too",
    theirStatus === null,
    "order status leaked to a stranger",
  );

  /* ── 3. an id that does not exist ───────────────────────────────────── */
  console.log("\n3. An order id that does not exist");
  check("returns null for the owner too", (await getOrderForUser(BOGUS_UUID, paid.userId)) === null);
  console.log("      ↳ same answer as 'not yours', so the page cannot be used");
  console.log("        to discover which order ids are real.");

  /* ── 4. the PENDING state the page must render honestly ─────────────── */
  console.log("\n4. A pending order (webhook has not landed yet)");
  const [liveEvent] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);

  const [buyer] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.role} = 'buyer'`)
    .orderBy(sql`${users.email} desc`)
    .limit(1);

  const free = await db.execute<{ id: string }>(sql`
    select st.id from ${seats} st
    where st.event_id = ${liveEvent.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id limit 2
  `);
  const pendingSeats = free.map((r) => r.id);
  touchedSeats.push(...pendingSeats);

  await createHold({ userId: buyer.id, seatIds: [...pendingSeats].sort() });
  const pending = await createPendingOrder({
    userId: buyer.id,
    seatIds: [...pendingSeats].sort(),
  });
  createdOrders.push(pending.orderId);

  const pendingView = await getOrderForUser(pending.orderId, buyer.id);
  check("the order is readable while pending", pendingView !== null);
  check("status is 'pending'", pendingView?.status === "pending");
  check(
    "it has NO seat lines yet — order_items is written by the webhook",
    pendingView?.seats.length === 0,
    `${pendingView?.seats.length} lines on an unpaid order — T27's rule was broken`,
  );
  check(
    "but the frozen total is already there to show",
    pendingView?.totalCents === pending.totalCents,
  );
  console.log("      ↳ this is the state the page polls out of, and why the");
  console.log("        seat list has to tolerate being empty.");

  const pendingStatus = await getOrderStatusForUser(pending.orderId, buyer.id);
  check("the poll sees pending with zero tickets", pendingStatus?.status === "pending");
  check("and reports ticketCount 0", pendingStatus?.ticketCount === 0);

  /* ── 5. the HTTP boundary, signed out ───────────────────────────────── */
  console.log("\n5. The routes themselves, signed out");

  const page = await fetch(`${BASE}/orders/${paid.id}/success`, { redirect: "manual" });
  check("the page redirects (307) rather than rendering", page.status === 307, `${page.status}`);
  const location = page.headers.get("location") ?? "";
  check(
    "straight to /login with an accurate ?next=",
    location.includes("/login") && location.includes(encodeURIComponent(`/orders/${paid.id}`)),
    location,
  );

  const api = await fetch(`${BASE}/api/orders/${paid.id}/status`);
  check(
    "the status API answers 401 JSON, NOT a redirect",
    api.status === 401,
    `${api.status} — a polling fetch() would parse a login page as JSON`,
  );
  const body = await api.json().catch(() => null);
  check("with the project's error envelope", body?.error?.code === "UNAUTHENTICATED");
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
