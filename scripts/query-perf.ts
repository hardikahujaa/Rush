/**
 * T38 — query performance.
 *
 *   npm run query-perf
 *
 * ── WHY THESE THREE QUERIES ─────────────────────────────────────────────
 * "Heaviest" is picked by which tables grow WITHOUT BOUND, not by which
 * query looks the busiest on the page. `seats`, `sections`, `order_items`
 * and `tickets` are all capped by the venue's seat count — `order_items`
 * can never exceed 3,168 rows across every event this app will ever sell,
 * because `one_sold_seat` permits exactly one row per seat, ever. `holds`
 * and `orders` have no such ceiling: every abandoned cart leaves a `holds`
 * row forever (T36's own schema comment says so explicitly), and every
 * failed or abandoned checkout leaves an `orders` row in `'pending'` or
 * `'failed'` that nothing ever deletes. Those two tables are where a real
 * production deployment's query plans degrade over months, and T36 shipped
 * three queries that hit them with no supporting index - deliberately, so
 * this task would have something real to find:
 *
 *   1. revenue / sales-over-time   - `orders` filtered by `event_id`
 *   2. the funnel's denominator    - `holds` joined to `seats` by `event_id`
 *   3. the hold<->sale correlation - `holds` joined by `(seat_id, user_id,
 *                                     created_at)`, shared by the funnel's
 *                                     numerator AND the average-time query
 *
 * ── WHY THE DATABASE IS PADDED BEFORE MEASURING ────────────────────────
 * This dev database currently has 2 rows in `holds` and 277 in `orders` - a
 * sequential scan over either is sub-millisecond regardless of indexing, so
 * a before/after captured right now would show nothing. Real numbers need a
 * realistic table size, so this script inserts ~300k synthetic `holds` and
 * ~150k synthetic `orders` with a single `INSERT ... SELECT FROM
 * generate_series`, spread across the real seats/users/events already in
 * the database - fast (one statement, no per-row round trip) and
 * referentially valid (every synthetic row points at a real seat, user, or
 * event).
 *
 * Every synthetic row carries the same sentinel timestamp -
 * `2000-06-15` - which exists nowhere in real seed data, so cleanup at the
 * end is one `DELETE ... WHERE created_at = '2000-06-15'` per table. The
 * indexes created along the way are NOT cleaned up - they are the actual
 * deliverable, and are also committed permanently via `src/db/schema.ts`
 * and a generated migration, so this script only proves what that
 * migration buys.
 *
 * Synthetic orders are `'pending'`/`'failed'` only and get no `order_items`
 * - so they bloat exactly the table the seq scan has to walk without
 * changing a single real revenue number. `ANALYZE` is run after the insert
 * so the planner's row-count estimates reflect the new size immediately,
 * the same way a production database's autovacuum would catch up on its
 * own schedule.
 */
import { closeDb, db } from "../src/db";
import { sql } from "drizzle-orm";

const SENTINEL = "2000-06-15 00:00:00+00";
const HOLDS_PADDING = 300_000;
const ORDERS_PADDING = 150_000;

function ms(n: number) {
  return `${n.toFixed(1)} ms`;
}

async function explain(label: string, query: ReturnType<typeof sql>) {
  const rows = await db.execute<{ "QUERY PLAN": string }>(
    sql`explain (analyze, buffers, format text) ${query}`,
  );
  const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
  const execTime = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? NaN);
  const planTime = Number(/Planning Time: ([\d.]+) ms/.exec(plan)?.[1] ?? NaN);
  const hasSeqScan = /Seq Scan on (holds|orders)\b/.test(plan);

  console.log(`\n  ── ${label} ──`);
  console.log(
    plan
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );

  return { execTime, planTime, hasSeqScan };
}

async function main() {
  console.log("\n1. Table sizes before padding");
  for (const t of ["holds", "orders"]) {
    const [{ n }] = await db.execute<{ n: string }>(sql.raw(`select count(*)::bigint as n from ${t}`));
    console.log(`      ${t.padEnd(8)} ${n}`);
  }

  const [event] = await db.execute<{ id: string }>(sql`select id from events limit 1`);
  const eventId = event.id;
  console.log(`\n  Benchmark event: ${eventId}`);

  /* ── 2. pad the two unbounded tables ────────────────────────────────── */
  console.log("\n2. Padding holds and orders to a realistic scale");

  await db.execute(sql`
    insert into holds (seat_id, user_id, expires_at, released_at, created_at)
    select
      seat_ids[1 + (gs % array_length(seat_ids, 1))],
      user_ids[1 + (gs % array_length(user_ids, 1))],
      ${SENTINEL}::timestamptz,
      ${SENTINEL}::timestamptz,
      ${SENTINEL}::timestamptz
    from generate_series(0, ${HOLDS_PADDING - 1}) gs,
      (select array_agg(id) as seat_ids from seats) s,
      (select array_agg(id) as user_ids from users) u
  `);
  console.log(`      inserted ${HOLDS_PADDING.toLocaleString("en-IN")} synthetic holds`);

  await db.execute(sql`
    insert into orders (user_id, event_id, total_cents, status, created_at)
    select
      user_ids[1 + (gs % array_length(user_ids, 1))],
      event_ids[1 + (gs % array_length(event_ids, 1))],
      150000,
      (array['pending', 'failed']::order_status[])[1 + (gs % 2)],
      ${SENTINEL}::timestamptz
    from generate_series(0, ${ORDERS_PADDING - 1}) gs,
      (select array_agg(id) as user_ids from users) u,
      (select array_agg(id) as event_ids from events) e
  `);
  console.log(`      inserted ${ORDERS_PADDING.toLocaleString("en-IN")} synthetic orders (pending/failed, no order_items)`);

  await db.execute(sql`analyze holds`);
  await db.execute(sql`analyze orders`);

  for (const t of ["holds", "orders"]) {
    const [{ n }] = await db.execute<{ n: string }>(sql.raw(`select count(*)::bigint as n from ${t}`));
    console.log(`      ${t.padEnd(8)} now has ${n} rows`);
  }

  /* ── 3. the three queries, exactly as analytics.ts issues them ───────── */
  const q1 = sql`
    select coalesce(sum(oi.price_cents), 0)::bigint as revenue_cents, count(distinct o.id)::bigint as paid_orders
    from orders o
    join order_items oi on oi.order_id = o.id
    where o.event_id = ${eventId} and o.status = 'paid'
  `;

  const q2 = sql`
    select count(*)::bigint as holds_created
    from holds h
    join seats st on st.id = h.seat_id
    where st.event_id = ${eventId}
  `;

  const q3 = sql`
    with converted as (
      select
        h.id as hold_id, oi.seat_id as seat_id, o.id as order_id,
        h.created_at as held_at, h.released_at as purchased_at,
        row_number() over (partition by oi.id order by h.created_at desc) as rn
      from order_items oi
      join orders o on o.id = oi.order_id
      left join holds h
        on h.seat_id = oi.seat_id and h.user_id = o.user_id and h.created_at <= o.created_at
      where o.event_id = ${eventId} and o.status = 'paid'
    )
    select count(*)::bigint as converted
    from converted where rn = 1 and hold_id is not null
  `;

  console.log("\n3. BEFORE — no supporting index on holds or orders");
  const before1 = await explain("Q1: revenue / sales-over-time (orders by event)", q1);
  const before2 = await explain("Q2: funnel denominator (holds via seats, by event)", q2);
  const before3 = await explain("Q3: hold<->sale correlation (funnel numerator + avg time)", q3);

  /* ── 4. the indexes ───────────────────────────────────────────────────── */
  console.log("\n4. Adding the two indexes — see src/db/schema.ts and the generated migration");

  await db.execute(sql`create index if not exists orders_event_status on orders (event_id, status)`);
  console.log("      orders_event_status        on orders (event_id, status)       -- fixes Q1");

  await db.execute(sql`create index if not exists holds_seat_user_created on holds (seat_id, user_id, created_at)`);
  console.log("      holds_seat_user_created     on holds (seat_id, user_id, created_at)  -- fixes Q2 and Q3");
  console.log(
    "      (ONE composite index, not two: its leading column alone already serves Q2's\n" +
      "       plain seat_id join, so a separate holds(seat_id) index would be redundant\n" +
      "       weight on every future INSERT for no query this app runs.)",
  );

  await db.execute(sql`analyze holds`);
  await db.execute(sql`analyze orders`);

  console.log("\n5. AFTER — same data, same queries, the new indexes in place");
  const after1 = await explain("Q1: revenue / sales-over-time (orders by event)", q1);
  const after2 = await explain("Q2: funnel denominator (holds via seats, by event)", q2);
  const after3 = await explain("Q3: hold<->sale correlation (funnel numerator + avg time)", q3);

  /* ── 6. the summary table for the README ─────────────────────────────── */
  console.log("\n6. Summary");
  console.log("  " + "─".repeat(70));
  console.log(
    "  query                                   before          after           speedup",
  );
  for (const [label, b, a] of [
    ["Q1 revenue / sales-over-time", before1, after1],
    ["Q2 funnel denominator", before2, after2],
    ["Q3 hold<->sale correlation", before3, after3],
  ] as const) {
    const speedup = b.execTime / a.execTime;
    console.log(
      `  ${label.padEnd(38)} ${ms(b.execTime).padEnd(15)} ${ms(a.execTime).padEnd(15)} ${speedup.toFixed(1)}x`,
    );
  }
  console.log("  " + "─".repeat(70));

  console.log(
    `\n  Q1 before had a Seq Scan on orders:  ${before1.hasSeqScan ? "YES" : "no"}` +
      `   after:  ${after1.hasSeqScan ? "YES — unexpected" : "no"}`,
  );
  console.log(
    `  Q2 before had a Seq Scan on holds:   ${before2.hasSeqScan ? "YES" : "no"}` +
      `   after:  ${after2.hasSeqScan ? "YES — unexpected" : "no"}`,
  );
  console.log(
    `  Q3 before had a Seq Scan on holds:   ${before3.hasSeqScan ? "YES" : "no"}` +
      `   after:  ${after3.hasSeqScan ? "YES — unexpected" : "no"}`,
  );
}

/**
 * The indexes created mid-run are DROPPED here, not kept - this script is a
 * repeatable demonstration, meant to be re-run on demand (for a fresh set of
 * numbers, or on a different event), and the permanent version of the same
 * two indexes lives in `src/db/schema.ts` plus its generated migration. Two
 * copies of "the same index" - one ad hoc, one migrated - would either
 * collide by name on the next `db:migrate`, or quietly diverge if someone
 * edited one without the other. One of them has to not exist outside this
 * run, and the migrated one is the one that is supposed to survive.
 */
async function cleanup() {
  const h = await db.execute<{ n: string }>(
    sql`delete from holds where created_at = ${SENTINEL}::timestamptz returning 1 as n`,
  );
  const o = await db.execute<{ n: string }>(
    sql`delete from orders where created_at = ${SENTINEL}::timestamptz returning 1 as n`,
  );
  await db.execute(sql`drop index if exists orders_event_status`);
  await db.execute(sql`drop index if exists holds_seat_user_created`);
  await db.execute(sql`analyze holds`);
  await db.execute(sql`analyze orders`);
  console.log(
    `\n  cleanup: removed ${h.length} synthetic hold(s), ${o.length} synthetic order(s), ` +
      "and dropped this run's ad-hoc indexes. The permanent versions live in " +
      "src/db/schema.ts and migration 0006 - run `npm run db:migrate` to have them.",
  );
}

main()
  .catch((error) => {
    console.error("\n  FAILED:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("  cleanup failed:", e));
    await closeDb().catch(() => {});
  });
