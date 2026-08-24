/**
 * Proves the three T10 constraints exist AND actually bite.
 *
 * Everything runs inside a transaction that is deliberately rolled back, so this
 * is safe to run against any database - it leaves nothing behind.
 *
 *   node --env-file=.env.local scripts/verify-constraints.mjs
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const sql = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
});

const ROLLBACK = "__rollback__";
let failures = 0;

function report(ok, label, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

console.log("\nTABLES");
const tables = await sql`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name`;
const names = tables.map((t) => t.table_name).filter((n) => n !== "__drizzle_migrations");
console.log("  " + names.join(", "));
report(names.length === 10, `10 tables present`, `found ${names.length}`);

console.log("\nCRITICAL INDEXES");
const wanted = ["one_live_hold_per_seat", "one_sold_seat", "seats_event_status"];
const idx = await sql`
  select indexname, indexdef from pg_indexes
  where schemaname = 'public' and indexname = any(${wanted})`;
for (const w of wanted) {
  const found = idx.find((i) => i.indexname === w);
  report(Boolean(found), w);
  if (found) console.log(`        ${found.indexdef}`);
}
const partial = idx.find((i) => i.indexname === "one_live_hold_per_seat");
report(
  Boolean(partial && /WHERE .*released_at IS NULL/i.test(partial.indexdef)),
  "one_live_hold_per_seat is PARTIAL (has the WHERE clause)",
);

console.log("\nLIVE BEHAVIOUR (inside a rolled-back transaction)");
try {
  await sql.begin(async (tx) => {
    const userId = randomUUID();
    const venueId = randomUUID();
    const eventId = randomUUID();
    const sectionId = randomUUID();
    const seatId = randomUUID();

    await tx`insert into users (id, email, role) values (${userId}, ${"probe-" + userId + "@example.test"}, 'buyer')`;
    await tx`insert into venues (id, name, city) values (${venueId}, 'Probe Venue', 'Chennai')`;
    await tx`insert into events (id, venue_id, organizer_id, title, drop_at, starts_at, status)
             values (${eventId}, ${venueId}, ${userId}, 'Probe Event', now(), now(), 'live')`;
    await tx`insert into sections (id, event_id, name, price_cents)
             values (${sectionId}, ${eventId}, 'Probe', 100000)`;
    await tx`insert into seats (id, event_id, section_id, row_label, seat_no, status)
             values (${seatId}, ${eventId}, ${sectionId}, 'A', 1, 'available')`;

    // 1 — two LIVE holds on one seat must be impossible.
    await tx`insert into holds (seat_id, user_id, expires_at)
             values (${seatId}, ${userId}, now() + interval '10 minutes')`;
    let blocked = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`insert into holds (seat_id, user_id, expires_at)
                 values (${seatId}, ${userId}, now() + interval '10 minutes')`;
      });
    } catch (e) {
      blocked = e.code === "23505";
    }
    report(blocked, "second LIVE hold on same seat is rejected", "23505 unique_violation");

    // 2 — but a RELEASED hold must not block a new one.
    await tx`update holds set released_at = now() where seat_id = ${seatId}`;
    let allowed = true;
    try {
      await tx`insert into holds (seat_id, user_id, expires_at)
               values (${seatId}, ${userId}, now() + interval '10 minutes')`;
    } catch {
      allowed = false;
    }
    report(allowed, "a new hold IS allowed once the previous one is released");

    // 3 — a seat can only ever appear on one order line.
    const orderA = randomUUID();
    const orderB = randomUUID();
    await tx`insert into orders (id, user_id, event_id, total_cents, status)
             values (${orderA}, ${userId}, ${eventId}, 100000, 'paid')`;
    await tx`insert into orders (id, user_id, event_id, total_cents, status)
             values (${orderB}, ${userId}, ${eventId}, 100000, 'paid')`;
    await tx`insert into order_items (order_id, seat_id, price_cents)
             values (${orderA}, ${seatId}, 100000)`;
    let oversellBlocked = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`insert into order_items (order_id, seat_id, price_cents)
                 values (${orderB}, ${seatId}, 100000)`;
      });
    } catch (e) {
      oversellBlocked = e.code === "23505";
    }
    report(oversellBlocked, "selling the same seat on a second order is rejected", "23505 unique_violation");

    // 4 — the same Stripe event cannot be processed twice.
    const evId = "evt_probe_" + randomUUID();
    await tx`insert into webhook_events (stripe_event_id) values (${evId})`;
    let dupeBlocked = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`insert into webhook_events (stripe_event_id) values (${evId})`;
      });
    } catch (e) {
      dupeBlocked = e.code === "23505";
    }
    report(dupeBlocked, "replaying the same Stripe event id is rejected", "23505 unique_violation");

    throw new Error(ROLLBACK);
  });
} catch (e) {
  if (e.message !== ROLLBACK) {
    console.log(`  FAIL  probe transaction errored: ${e.code ?? ""} ${e.message}`);
    failures++;
  }
}

const [{ count }] = await sql`select count(*)::int as count from holds`;
report(count === 0, "probe data rolled back cleanly", `holds table has ${count} rows`);

await sql.end();
console.log(failures === 0 ? "\nAll constraint checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
