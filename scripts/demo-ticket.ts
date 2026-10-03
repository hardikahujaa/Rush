/**
 * DEV-ONLY: point an existing paid order at your account so you can open
 * /tickets and look at a real signed QR without running a card payment.
 *
 *   npm run demo-ticket -- you@example.com
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Every ticket in the seeded database belongs to a `buyer<n>@rush.demo` row in
 * `public.users`. Those rows have no Supabase Auth credentials - the seed
 * creates business records, not login accounts - so you cannot sign in as them
 * to view their tickets. The honest way to get a ticket of your own is to pay
 * for one (see the Stripe CLI route in PLAN.md's T30 note); this is the
 * five-second way.
 *
 * It only ever runs an UPDATE on `orders.user_id`. `order_items` and `tickets`
 * are keyed on `order_id`, so they follow the order without being touched, and
 * every `qr_signature` stays valid because the signature covers
 * ticket/order/seat ids - none of which change here.
 *
 * REVERSIBLE: it prints the command that puts the order back.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import { events, orders, tickets, users } from "../src/db/schema";

async function main() {
  /* Refuses outright in production. Reassigning somebody's order is a
     perfectly reasonable thing to do on a local database and an absurd thing
     to do on a live one. */
  if (process.env.NODE_ENV === "production") {
    throw new Error("demo-ticket is a development helper and will not run in production");
  }

  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("\n  Usage: npm run demo-ticket -- you@example.com\n");
    console.error("  Pass the email of an account you can actually SIGN IN as.");
    console.error("  Signed-up accounts in this database:\n");
    const candidates = await db
      .select({ email: users.email, role: users.role })
      .from(users)
      .where(sql`${users.email} not like '%@rush.demo'`)
      .limit(20);
    for (const c of candidates) console.error(`    ${c.email}  (${c.role})`);
    console.error("");
    process.exit(1);
  }

  const [target] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!target) {
    throw new Error(
      `No user with email ${email}. Sign up at /signup first, then re-run this.`,
    );
  }

  /* Prefer an order that actually has tickets attached and belongs to somebody
     else - reassigning one the target already owns would be a no-op that looks
     like success. */
  const [candidate] = await db
    .select({
      orderId: orders.id,
      currentOwnerId: orders.userId,
      currentOwnerEmail: users.email,
      eventTitle: events.title,
      totalCents: orders.totalCents,
      ticketCount: sql<number>`(select count(*)::int from ${tickets} t where t.order_id = ${orders.id})`,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(
      and(
        eq(orders.status, "paid"),
        sql`${orders.userId} <> ${target.id}`,
        sql`(select count(*) from ${tickets} t where t.order_id = ${orders.id}) between 2 and 4`,
      ),
    )
    .limit(1);

  if (!candidate) {
    throw new Error(
      "No reassignable paid order with 2-4 tickets found. Run `npm run db:seed` first.",
    );
  }

  await db
    .update(orders)
    .set({ userId: target.id })
    .where(eq(orders.id, candidate.orderId));

  console.log(`\n  Moved order ${candidate.orderId}`);
  console.log(`    event   : ${candidate.eventTitle}`);
  console.log(`    tickets : ${candidate.ticketCount}`);
  console.log(`    total   : Rs ${(candidate.totalCents / 100).toLocaleString("en-IN")}`);
  console.log(`    from    : ${candidate.currentOwnerEmail}`);
  console.log(`    to      : ${target.email}`);
  console.log(`\n  Sign in as ${target.email}, then open:`);
  console.log(`    http://localhost:3000/tickets\n`);
  console.log(`  To put it back:`);
  console.log(`    npm run demo-ticket -- ${candidate.currentOwnerEmail}\n`);
}

/* Explicit exit codes, and no `finally` that could mask a failure with a 0.
   The exit is needed at all because the postgres pool keeps the event loop
   alive otherwise. */
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
