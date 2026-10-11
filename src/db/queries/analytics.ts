import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { events } from "@/db/schema";

/**
 * ORGANIZER ANALYTICS (T36).
 *
 * Five read-only reports for one event: revenue, sell-through per section,
 * sales over time, the hold-to-purchase funnel, and the average time that
 * funnel takes. T37 renders these; nothing here touches a route handler.
 *
 * ── EVERY FUNCTION TAKES AN `organizerId`, AND THAT IS NOT IN THE BRIEF ────
 * The brief only asked for the five SQL queries. It did not ask for an
 * authorization check, because `/organizer` currently has none beyond
 * `requireRole("organizer")` - which proves a visitor IS an organizer, not
 * that they own the event they are about to see the revenue of. Without a
 * check here, any organizer account could read any other organizer's sales by
 * guessing a uuid in the URL. `events.organizer_id` already exists for exactly
 * this purpose and nothing reads it yet.
 *
 * So every function below resolves `(eventId, organizerId) -> the event row`
 * first, and returns `null` for an event that does not exist OR belongs to
 * someone else - the two cases are made indistinguishable on purpose, the same
 * way `/orders/[id]` returns `notFound()` for a stranger's order rather than
 * a 403 that would confirm the id is real. This is the actual enforcement
 * layer, inside the thing being protected - a page-level check alone would be
 * the same mistake `src/proxy.ts`'s own documentation warns against.
 *
 * ── WHAT "PURCHASED" MEANS WHEN THERE IS NO `paid_at` COLUMN ────────────────
 * `orders` has `created_at` (when checkout STARTED) and `status`, nothing that
 * timestamps the moment it became `'paid'`. But `webhooks.ts` sets that status,
 * creates `order_items` and `tickets`, AND releases the converting hold -
 * `holds.released_at = now()` - all inside the one fulfilment transaction. So a
 * converted hold's own `released_at` IS the purchase instant, to the same
 * precision as everything else that transaction wrote, with no schema change.
 * `getAvgHoldToPurchase` uses exactly this.
 *
 * ── CORRELATING A HOLD TO A SALE NEEDS A WINDOW FUNCTION ────────────────────
 * `order_items` carries a `seat_id`, never a `hold_id` - the two tables were
 * never linked, because a seat can be held, released, and re-held by different
 * people before it finally sells, so "the hold for this seat" is ambiguous
 * without the buyer and the timing. `one_sold_seat` guarantees at most one
 * order_item per seat ever, so there is exactly one buyer - but picking out
 * THEIR hold among possibly several needs `ROW_NUMBER() OVER (PARTITION BY
 * order_item ORDER BY hold.created_at DESC)`, keeping the most recent hold that
 * (a) belongs to the buyer and (b) existed before the order did. That is the
 * only hold `createPendingOrder` could have extended and the webhook could
 * later have released, so it is the converting one.
 *
 * `convertedHolds` below is that correlation written once, as a CTE fragment
 * reused by both the funnel (#4) and the average (#5) - so the two queries
 * cannot quietly disagree about which holds count as conversions.
 */

type OwnedEvent = { id: string };

async function ownedEvent(eventId: string, organizerId: string): Promise<OwnedEvent | null> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizerId, organizerId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The shared correlation, as a raw SQL fragment rather than a Drizzle query
 * builder expression - it has to be embeddable as a CTE inside two different
 * statements, and Drizzle's query builder produces a full statement, not a
 * composable clause.
 *
 * Columns: `hold_id`, `seat_id`, `order_id`, `held_at` (hold.created_at),
 * `purchased_at` (hold.released_at - see the module note on why this is the
 * purchase instant).
 */
function convertedHoldsCte(eventId: string) {
  return sql`
    with converted as (
      select
        h.id as hold_id,
        oi.seat_id as seat_id,
        o.id as order_id,
        h.created_at as held_at,
        h.released_at as purchased_at,
        row_number() over (
          partition by oi.id
          order by h.created_at desc
        ) as rn
      from order_items oi
      join orders o on o.id = oi.order_id
      left join holds h
        on h.seat_id = oi.seat_id
       and h.user_id = o.user_id
       and h.created_at <= o.created_at
      where o.event_id = ${eventId}
        and o.status = 'paid'
    )
    select hold_id, seat_id, order_id, held_at, purchased_at
    from converted
    where rn = 1
  `;
}

/* ── 1. total revenue ──────────────────────────────────────────────────── */

export type EventRevenue = {
  revenueCents: number;
  paidOrders: number;
};

/**
 * Total revenue for one event, and how many orders produced it.
 *
 * Summed from `order_items.price_cents` - the price FROZEN at purchase time -
 * never from `sections.price_cents`, which is live and can have changed since.
 * `schema.ts`'s own comment on `order_items` says why: a receipt priced through
 * a join to a section whose price later moved would retroactively rewrite what
 * the customer paid.
 *
 * Scoped to `status = 'paid'`: a `'pending'` order has no guaranteed outcome
 * yet, a `'failed'` one never charged anyone, and a `'refunded'` one (the enum
 * allows it; nothing in this codebase sets it yet) should stop counting the
 * moment it exists, for free, since the filter is an allow-list rather than an
 * exclude-list.
 *
 * `COALESCE(..., 0)`: an event with zero sales must report 0, not `null` -
 * `SUM()` over an empty set is `null` in SQL, and a dashboard that forwards
 * that unchanged renders "₹NaN".
 */
export async function getEventRevenue(
  eventId: string,
  organizerId: string,
): Promise<EventRevenue | null> {
  if (!(await ownedEvent(eventId, organizerId))) return null;

  const rows = await db.execute<{ revenue_cents: string | null; paid_orders: string }>(sql`
    select
      coalesce(sum(oi.price_cents), 0)::bigint as revenue_cents,
      count(distinct o.id)::bigint as paid_orders
    from orders o
    join order_items oi on oi.order_id = o.id
    where o.event_id = ${eventId}
      and o.status = 'paid'
  `);

  const row = rows[0];
  return {
    /* `db.execute` bypasses Drizzle's column mapping, so a `bigint` arrives as
       a string - the same trap that turned a `Date` column into a string
       elsewhere in this project. Cast explicitly rather than trust the driver. */
    revenueCents: Number(row?.revenue_cents ?? 0),
    paidOrders: Number(row?.paid_orders ?? 0),
  };
}

/* ── 2. sell-through per section ───────────────────────────────────────── */

export type SectionSellThrough = {
  sectionId: string;
  name: string;
  priceCents: number;
  totalSeats: number;
  soldSeats: number;
  /** 0-100, one decimal. */
  sellThroughPct: number;
};

/**
 * Sold ÷ total, per section.
 *
 * "Sold" is counted through `order_items` joined to a `'paid'` order - never
 * `seats.status`, which is a render cache for the seat map and, per T22, can
 * read `'held'` on a seat that is already available again. A sell-through
 * report built from the cache would overstate demand on exactly the seats
 * whose holds just expired.
 *
 * `LEFT JOIN` from `sections`, not `INNER`, so a section with zero sales still
 * appears at 0% rather than vanishing from the report - a newly added, unsold
 * section is a fact an organizer needs to see, not a row that silently isn't
 * there.
 */
export async function getSectionSellThrough(
  eventId: string,
  organizerId: string,
): Promise<SectionSellThrough[] | null> {
  if (!(await ownedEvent(eventId, organizerId))) return null;

  const rows = await db.execute<{
    section_id: string;
    name: string;
    price_cents: number;
    total_seats: string;
    sold_seats: string;
  }>(sql`
    select
      sec.id as section_id,
      sec.name as name,
      sec.price_cents as price_cents,
      count(distinct st.id)::bigint as total_seats,
      count(distinct oi.seat_id)::bigint as sold_seats
    from sections sec
    join seats st on st.section_id = sec.id
    left join order_items oi
      on oi.seat_id = st.id
     and exists (
       select 1 from orders o
        where o.id = oi.order_id and o.status = 'paid'
     )
    where sec.event_id = ${eventId}
    group by sec.id, sec.name, sec.price_cents
    order by sec.price_cents desc
  `);

  return rows.map((row) => {
    const total = Number(row.total_seats);
    const sold = Number(row.sold_seats);
    return {
      sectionId: row.section_id,
      name: row.name,
      priceCents: row.price_cents,
      totalSeats: total,
      soldSeats: sold,
      /* Guarded explicitly: a section can theoretically have zero seats (data
         error) and 0/0 must read as 0%, not throw or render NaN%. */
      sellThroughPct: total === 0 ? 0 : Math.round((sold / total) * 1000) / 10,
    };
  });
}

/* ── 3. sales over time ────────────────────────────────────────────────── */

export type SalesBucket = {
  hour: Date;
  revenueCents: number;
  ordersCount: number;
  /** Running total through this hour. */
  cumulativeRevenueCents: number;
};

/**
 * Hourly revenue from the event's drop until now, with gaps filled.
 *
 * ── THE SPINE, AND WHY IT IS GENERATED RATHER THAN READ ─────────────────
 * A chart built only from hours that had a sale draws a misleading line
 * through an idle Tuesday afternoon as if nothing distinguishes it from the
 * drop-minute spike. `generate_series(drop_at, now(), '1 hour')` manufactures
 * every hour in the window first; sales are then LEFT JOINed onto it, so a
 * quiet hour reports 0 rather than not existing.
 *
 * ── THE WINDOW FUNCTION THE BRIEF ASKS FOR ────────────────────────────────
 * `sum(revenue) over (order by hour)` - a running total, computed in the same
 * pass as the per-bucket sum. Because it is the SAME underlying rows, the last
 * bucket's cumulative figure is mathematically guaranteed to equal
 * `getEventRevenue`'s total; the verification script checks exactly that
 * agreement.
 *
 * ── THE SERIES ENDS AT `now()`, NEVER EARLIER ─────────────────────────────
 * An earlier version of this query capped the end at `drop_at + 14 days` to
 * guard against a future `drop_at` producing a series that runs backwards.
 * That guard was solving a problem `generate_series` already solves itself -
 * `start > end` with a positive step returns zero rows, not an error - while
 * silently creating a real one: ANY event that dropped more than two weeks ago
 * would have its chart truncated two weeks in, hiding every sale from then
 * until today. The end is simply `now()`.
 *
 * ── THE START IS CLAMPED, WHICH IS A DIFFERENT AND SAFE GUARD ─────────────
 * `greatest(drop_at, now() - interval '90 days')`. This can only ever shorten
 * the window from the FAR end - a `drop_at` three years ago still produces a
 * useful chart, just capped to the last 90 days of it, rather than Postgres
 * materialising tens of thousands of hourly rows for a stale fixture. A recent
 * `drop_at` is never affected, since `greatest()` leaves it untouched.
 */
export async function getSalesOverTime(
  eventId: string,
  organizerId: string,
): Promise<SalesBucket[] | null> {
  if (!(await ownedEvent(eventId, organizerId))) return null;

  const rows = await db.execute<{
    hour: string;
    revenue_cents: string;
    orders_count: string;
    cumulative_revenue_cents: string;
  }>(sql`
    with spine as (
      select generate_series(
        date_trunc('hour', greatest(e.drop_at, now() - interval '90 days')),
        date_trunc('hour', now()),
        interval '1 hour'
      ) as hour
      from events e
      where e.id = ${eventId}
    ),
    sales as (
      select
        date_trunc('hour', o.created_at) as hour,
        sum(oi.price_cents) as revenue_cents,
        count(distinct o.id) as orders_count
      from orders o
      join order_items oi on oi.order_id = o.id
      where o.event_id = ${eventId}
        and o.status = 'paid'
      group by 1
    )
    select
      spine.hour as hour,
      coalesce(sales.revenue_cents, 0)::bigint as revenue_cents,
      coalesce(sales.orders_count, 0)::bigint as orders_count,
      sum(coalesce(sales.revenue_cents, 0)) over (order by spine.hour)::bigint
        as cumulative_revenue_cents
    from spine
    left join sales on sales.hour = spine.hour
    order by spine.hour asc
  `);

  return rows.map((row) => ({
    hour: new Date(row.hour),
    revenueCents: Number(row.revenue_cents),
    ordersCount: Number(row.orders_count),
    cumulativeRevenueCents: Number(row.cumulative_revenue_cents),
  }));
}

/* ── 4. conversion funnel ──────────────────────────────────────────────── */

export type ConversionFunnel = {
  holdsCreated: number;
  holdsConverted: number;
  /** 0-100, one decimal. */
  conversionRatePct: number;
};

/**
 * Holds created -> holds that became a paid sale.
 *
 * `holds` has no `event_id` column - a hold points at a seat, a seat points at
 * an event - so the denominator joins through `seats` rather than filtering
 * `holds` directly. This is also one of the three heaviest query SHAPES T38 is
 * meant to find: there is no index that lets Postgres jump straight from
 * `event_id` to the matching holds without visiting every seat in the event
 * first, and that is left exactly that expensive on purpose - see the module
 * note on why T36 adds no indexes.
 *
 * The numerator reuses `convertedHolds`: a hold counts as converted only if it
 * is the ROW_NUMBER()-selected hold behind an actual `order_item` on a `'paid'`
 * order, never merely "this hold's `released_at` is non-null" - that column is
 * also set by a voluntary release (`releaseHolds`) and by the nightly cleanup
 * cron sweeping an abandoned hold, neither of which is a sale.
 */
export async function getConversionFunnel(
  eventId: string,
  organizerId: string,
): Promise<ConversionFunnel | null> {
  if (!(await ownedEvent(eventId, organizerId))) return null;

  const [createdRows, convertedRows] = await Promise.all([
    db.execute<{ holds_created: string }>(sql`
      select count(*)::bigint as holds_created
      from holds h
      join seats st on st.id = h.seat_id
      where st.event_id = ${eventId}
    `),
    db.execute<{ holds_converted: string }>(sql`
      with converted_set as (${convertedHoldsCte(eventId)})
      select count(*)::bigint as holds_converted
      from converted_set
      where hold_id is not null
    `),
  ]);

  const created = Number(createdRows[0]?.holds_created ?? 0);
  const converted = Number(convertedRows[0]?.holds_converted ?? 0);

  return {
    holdsCreated: created,
    holdsConverted: converted,
    conversionRatePct: created === 0 ? 0 : Math.round((converted / created) * 1000) / 10,
  };
}

/* ── 5. average hold-to-purchase time ──────────────────────────────────── */

export type AvgHoldToPurchase = {
  /** Null when nothing has converted yet - never 0, which would claim an
   *  instant purchase rather than "no data". */
  avgSeconds: number | null;
  sampleSize: number;
};

/**
 * Average seconds between a hold being created and the purchase it produced.
 *
 * "Purchase" is `holds.released_at` from the SAME converted-hold correlation
 * as the funnel above - see the module note on why that column, set inside the
 * webhook's one fulfilment transaction, is the purchase instant with no schema
 * change needed.
 *
 * Returns `null` rather than `0` for an event with no conversions yet: `AVG()`
 * over zero rows is SQL `null`, and forwarding that as `0` would tell an
 * organizer their checkout is instantaneous when in fact nobody has checked
 * out at all.
 */
export async function getAvgHoldToPurchase(
  eventId: string,
  organizerId: string,
): Promise<AvgHoldToPurchase | null> {
  if (!(await ownedEvent(eventId, organizerId))) return null;

  const rows = await db.execute<{ avg_seconds: string | null; sample_size: string }>(sql`
    with converted_set as (${convertedHoldsCte(eventId)})
    select
      avg(extract(epoch from (purchased_at - held_at))) as avg_seconds,
      count(*)::bigint as sample_size
    from converted_set
    where hold_id is not null
  `);

  const row = rows[0];
  const avg = row?.avg_seconds;
  return {
    avgSeconds: avg === null || avg === undefined ? null : Number(avg),
    sampleSize: Number(row?.sample_size ?? 0),
  };
}
