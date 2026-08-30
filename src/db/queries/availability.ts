import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { holds, orderItems } from "@/db/schema";

/**
 * THE DEFINITION OF A TAKEN SEAT. There is no other.
 *
 * Before this file, the same predicate was spelled out by hand in nine places:
 * the event detail counts, three seat-map queries, two inside the hold
 * transaction, and three more in the test scripts. Nine copies of one rule is
 * nine chances for them to drift, and drift here is not cosmetic - it is a seat
 * the map offers and the API refuses, or worse, one the map hides and nobody
 * can buy.
 *
 * ── LAZY EXPIRY LIVES HERE ─────────────────────────────────────────────────
 * A hold frees its seat the moment `expires_at` passes, with no cron job, no
 * cleanup worker, and no write of any kind. The row stays in the table with
 * `released_at IS NULL`; it simply stops satisfying `expires_at > now()`, so
 * every query stops counting it.
 *
 * That is strictly better than scheduled cleanup, and the reason is timing. A
 * cron job that runs every minute leaves up to a minute where a seat is free in
 * reality and taken in the database. During a drop that minute is precisely
 * when the seat is worth the most, and precisely when the queue is longest.
 * Deciding at read time means the window is zero, by construction.
 *
 * ── WHY `seats.status` IS NOT PART OF ANY RULE BELOW ───────────────────────
 * `schema.ts` says it plainly: status is a render cache, not the truth. An
 * expired hold leaves `'held'` behind until something happens to rewrite it. A
 * rule that required `status = 'held'` would make an expired seat unsellable;
 * a rule that trusted `status = 'available'` would offer a seat that is
 * genuinely held. The source of truth is `order_items` and live holds, and it
 * is the only thing consulted here.
 *
 * Each function takes the seat reference as a fragment - `sql\`st.id\`` - so the
 * same rule composes into a scalar select, a `count(...) filter`, or a `case`,
 * against whatever alias the calling query uses.
 */

/** Sold: an order line claims this seat. Permanent, and beats everything. */
export function seatIsSold(seatRef: SQL): SQL {
  return sql`exists (select 1 from ${orderItems} oi where oi.seat_id = ${seatRef})`;
}

/**
 * What makes a hold row count at all: unreleased AND not yet expired.
 *
 * Both halves matter. `released_at is null` excludes holds that were explicitly
 * given back; `expires_at > now()` excludes holds that simply ran out. Drop the
 * second and expired holds keep their seats forever - which is the entire bug
 * lazy expiry exists to prevent.
 *
 * Takes the hold alias, so it composes into an EXISTS, a scalar subquery, or a
 * join predicate against whatever the calling query called the table.
 */
export function holdIsLive(holdAlias: SQL): SQL {
  return sql`${holdAlias}.released_at is null and ${holdAlias}.expires_at > now()`;
}

/** Held: some live hold covers this seat. */
export function seatHasLiveHold(seatRef: SQL): SQL {
  return sql`exists (
    select 1 from ${holds} h
    where h.seat_id = ${seatRef} and ${holdIsLive(sql`h`)}
  )`;
}

/**
 * WHO holds this seat, or null.
 *
 * The hold API needs more than a boolean: a caller who already owns the live
 * hold is retrying, not colliding, and must get their seats back rather than a
 * "someone took these" it would be a lie to send them.
 */
export function liveHoldOwner(seatRef: SQL): SQL {
  return sql`(
    select h.user_id from ${holds} h
    where h.seat_id = ${seatRef} and ${holdIsLive(sql`h`)}
    limit 1
  )`;
}

/** Available: neither sold nor under a live hold. */
export function seatIsAvailable(seatRef: SQL): SQL {
  return sql`not ${seatIsSold(seatRef)} and not ${seatHasLiveHold(seatRef)}`;
}

/**
 * The three-way status, as one expression.
 *
 * PRECEDENCE LIVES HERE, ONCE. Sold outranks held, because a seat that has been
 * paid for is gone regardless of what hold rows survive alongside it. That
 * ordering used to exist only inside one `case` while a sibling aggregate
 * counted `held` without excluding sold seats - so a sold seat carrying an
 * unreleased hold was counted twice and `available + held + sold` exceeded the
 * number of seats in the room. Anything deriving counts from this expression
 * cannot reproduce that.
 */
export function seatStatusExpr(seatRef: SQL): SQL {
  return sql`case
    when ${seatIsSold(seatRef)} then 'sold'
    when ${seatHasLiveHold(seatRef)} then 'held'
    else 'available'
  end`;
}
