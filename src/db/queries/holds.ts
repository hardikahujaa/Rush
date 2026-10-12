import "server-only";

import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { isDeadlockError, isUniqueViolation } from "@/db/pg-error";
import {
  holdIsLive,
  liveHoldOwner,
  seatIsSold,
} from "@/db/queries/availability";
import { events, holds, seats, sections } from "@/db/schema";
import { calculateTotalCents } from "@/lib/pricing";
import { MAX_SEATS_PER_USER } from "@/lib/validation/holds";

/** How long a buyer gets to reach checkout before the seats go back on sale. */
const HOLD_MINUTES = 10;

/* ── failures ───────────────────────────────────────────────────────────── */

export type HoldFailure =
  | { code: "SEATS_NOT_FOUND"; seatIds: string[] }
  | { code: "MIXED_EVENTS" }
  | { code: "EVENT_NOT_ON_SALE"; reason: "not_live" | "not_dropped" }
  | { code: "SEATS_UNAVAILABLE"; seatIds: string[] }
  | { code: "SEAT_LIMIT_EXCEEDED"; alreadyHeld: number; max: number };

/**
 * Thrown inside the transaction to abort it.
 *
 * Drizzle rolls back on ANY thrown error, so this both aborts and carries the
 * detail the caller needs. `tx.rollback()` would also roll back, but it throws a
 * bare TransactionRollbackError with nowhere to put "which seats conflicted" -
 * and the whole value of a 409 here is naming the seats so the UI can grey them
 * out rather than saying "something went wrong".
 */
export class HoldError extends Error {
  constructor(readonly failure: HoldFailure) {
    super(failure.code);
    this.name = "HoldError";
  }
}

/* ── result ─────────────────────────────────────────────────────────────── */

export type HeldSeat = {
  holdId: string;
  seatId: string;
  sectionName: string;
  rowLabel: string;
  seatNo: number;
  priceCents: number;
};

export type HoldResult = {
  eventId: string;
  seats: HeldSeat[];
  expiresAt: Date;
  totalCents: number;
  /** True when this request created nothing because the caller already held
   *  every seat - i.e. it was a retry, not a new claim. */
  replayed: boolean;
};

/* ── the transaction ────────────────────────────────────────────────────── */

/**
 * Claim seats for a user, or fail without claiming any of them.
 *
 * THIS IS THE FUNCTION THE WHOLE PROJECT EXISTS TO GET RIGHT. Under a drop,
 * hundreds of people request the same seat in the same instant. Exactly one may
 * win, and the losers must be told cleanly rather than silently double-sold.
 *
 * Three independent layers stop an oversell, and all three must stay:
 *   1. `SELECT ... FOR UPDATE` below, which serialises competing transactions
 *   2. `one_live_hold_per_seat`, the partial unique index, which rejects a
 *      second live hold even if layer 1 were somehow bypassed
 *   3. `one_sold_seat` on order_items, the final backstop at purchase time
 *
 * Layer 1 is application logic and could be wrong. Layers 2 and 3 live in the
 * database, where a TypeScript bug cannot reach them.
 */
export async function createHold({
  userId,
  seatIds,
}: {
  userId: string;
  /** Already de-duplicated and sorted by `createHoldSchema`. */
  seatIds: string[];
}): Promise<HoldResult> {
  return db.transaction(async (tx) => {
    /* ── 1. LOCK THE SEATS, IN A DETERMINISTIC ORDER ──────────────────────
     *
     * `FOR UPDATE` takes a row-level exclusive lock on every seat returned. A
     * second transaction asking for any of the same seats BLOCKS here until
     * this one commits or rolls back. That is what turns "check then insert"
     * from a race into a queue.
     *
     * The `ORDER BY` is the deadlock prevention, and it is worth being precise
     * about why, because sorting the array in JavaScript does NOT do it -
     * `WHERE id IN (...)` does not lock in the order the list was written.
     * EXPLAIN on this database shows:
     *
     *     LockRows
     *       ->  Index Scan using seats_pkey on seats
     *
     * LockRows sits ABOVE the scan, so rows are locked in whatever order the
     * node beneath emits them. With ORDER BY id, Postgres satisfies the sort
     * straight from seats_pkey and emits ascending - it does not even add a
     * Sort node. Every transaction therefore grabs seat locks in the same
     * ascending order, so a cycle (A waits on B while B waits on A) cannot
     * form. Drop the ORDER BY and the emission order becomes whatever the plan
     * happens to produce, which is a deadlock waiting for a busy afternoon.
     */
    const locked = await tx
      .select({
        id: seats.id,
        eventId: seats.eventId,
      })
      .from(seats)
      .where(inArray(seats.id, seatIds))
      .orderBy(seats.id)
      .for("update");

    /* ── 2. EXISTENCE AND COHESION ─────────────────────────────────────── */
    if (locked.length !== seatIds.length) {
      const found = new Set(locked.map((s) => s.id));
      throw new HoldError({
        code: "SEATS_NOT_FOUND",
        seatIds: seatIds.filter((id) => !found.has(id)),
      });
    }

    const eventId = locked[0].eventId;
    if (locked.some((s) => s.eventId !== eventId)) {
      // One hold spanning two events would produce an order with no single
      // event, which the orders table cannot represent.
      throw new HoldError({ code: "MIXED_EVENTS" });
    }

    /* ── 3. IS THIS EVENT ACTUALLY ON SALE? ─────────────────────────────
     *
     * Not ceremony. Without this check a script holds every seat in the house
     * a minute BEFORE the drop, and the queue everyone else is waiting in is
     * for an empty room. `drop_at` is compared against the database clock, not
     * the app server's.
     */
    const eventRows = await tx
      .select({
        status: events.status,
        dropped: sql<boolean>`${events.dropAt} <= now()`,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    const event = eventRows[0];
    if (!event || event.status !== "live") {
      throw new HoldError({ code: "EVENT_NOT_ON_SALE", reason: "not_live" });
    }
    if (!event.dropped) {
      throw new HoldError({ code: "EVENT_NOT_ON_SALE", reason: "not_dropped" });
    }

    /* ── 4. RELEASE EXPIRED HOLDS ON THESE SEATS ────────────────────────
     *
     * WITHOUT THIS STEP THE ENDPOINT BREAKS PERMANENTLY, and it is worth
     * spelling out because it is not obvious.
     *
     * `one_live_hold_per_seat` is unique on seat_id WHERE released_at IS NULL.
     * An EXPIRED hold still has released_at IS NULL - expiry is a timestamp
     * comparison, not a state change. So a seat whose hold ran out ten minutes
     * ago is genuinely available by every availability query in the codebase,
     * and yet inserting a new hold for it violates the unique index.
     *
     * The result would be: hold expires -> next buyer is told the seat is free
     * -> insert dies on 23505 -> they are told someone grabbed it -> and that
     * seat can never be sold again by anyone, ever.
     *
     * Releasing here is safe because we already hold the row locks from step 1,
     * so no concurrent transaction can be mid-decision about these seats.
     *
     * ── T22 WRITE-PATH CONFIRMATION ───────────────────────────────────────
     * This is the overwrite lazy expiry needs, and it was already correct when
     * T20 shipped: user B requesting a seat whose hold belongs to user A and
     * whose `expires_at` has passed gets A's hold released here, then B's hold
     * inserted below. Proven, not assumed - `scripts/hold-test.ts` test 5 does
     * exactly that, and deleting this UPDATE makes it fail with a 23505 on
     * `one_live_hold_per_seat`. No change was needed for T22.
     *
     * The condition is the inverse of `holdIsLive` in queries/availability.ts.
     * It is written with Drizzle conditions rather than that fragment only
     * because this is an UPDATE ... WHERE over the holds table, not a test
     * applied to a seat.
     */
    await tx
      .update(holds)
      .set({ releasedAt: sql`now()` })
      .where(
        and(
          inArray(holds.seatId, seatIds),
          isNull(holds.releasedAt),
          lte(holds.expiresAt, sql`now()`),
        ),
      );

    /* ── 5. AVAILABILITY, FROM THE SOURCE OF TRUTH ──────────────────────
     *
     * NOT from `seats.status`. That column is a render cache - schema.ts says
     * so explicitly - and it lags: an expired hold leaves 'held' behind. The
     * authoritative answer is whether a row exists in order_items (sold) or a
     * live unexpired hold exists (held). Reading the cache here would make
     * every expired seat permanently unsellable.
     *
     * `heldBy` is captured so a caller who already owns the hold can be told
     * apart from a stranger who does - that distinction is what makes a retry
     * safe rather than a lie.
     */
    const availability = await tx.execute<{
      id: string;
      sold: boolean;
      held_by: string | null;
    }>(sql`
      select
        st.id,
        ${seatIsSold(sql`st.id`)}    as sold,
        ${liveHoldOwner(sql`st.id`)} as held_by
      from ${seats} st
      where st.id in ${seatIds}
    `);

    const takenByOthers: string[] = [];
    const alreadyMine: string[] = [];

    for (const row of availability) {
      if (row.sold) takenByOthers.push(row.id);
      else if (row.held_by === userId) alreadyMine.push(row.id);
      else if (row.held_by !== null) takenByOthers.push(row.id);
    }

    if (takenByOthers.length > 0) {
      throw new HoldError({ code: "SEATS_UNAVAILABLE", seatIds: takenByOthers.sort() });
    }

    /* ── 6. IDEMPOTENT REPLAY ────────────────────────────────────────────
     *
     * The seats the caller already holds are not conflicts - they are evidence
     * that an earlier attempt succeeded and the response was lost. Re-inserting
     * would trip the unique index; refusing would tell someone a stranger stole
     * seats that are already theirs. Only the genuinely unheld seats get new
     * rows, and the response returns all of them either way.
     */
    const mine = new Set(alreadyMine);
    const toInsert = seatIds.filter((id) => !mine.has(id));

    /* ── 7. PURCHASE LIMIT, PER USER PER EVENT ──────────────────────────
     *
     * A per-request cap alone is not a purchase limit: calling this endpoint
     * ten times would sit on forty seats, which is precisely the scalping this
     * product is meant to resist. Counting the caller's other live holds on
     * this event closes that. Seats already in this request are excluded so a
     * retry is not charged twice against the cap.
     */
    if (toInsert.length > 0) {
      const otherHeld = await tx.execute<{ count: number }>(sql`
        select count(*)::int as count
        from ${holds} h
        join ${seats} st on st.id = h.seat_id
        where h.user_id = ${userId}
          and st.event_id = ${eventId}
          and ${holdIsLive(sql`h`)}
          and h.seat_id not in ${seatIds}
      `);

      const existing = Number(otherHeld[0]?.count ?? 0);
      if (existing + alreadyMine.length + toInsert.length > MAX_SEATS_PER_USER) {
        throw new HoldError({
          code: "SEAT_LIMIT_EXCEEDED",
          alreadyHeld: existing + alreadyMine.length,
          max: MAX_SEATS_PER_USER,
        });
      }
    }

    /* ── 8. INSERT THE HOLDS ─────────────────────────────────────────────
     *
     * `expiresAt` is derived from the DATABASE clock, not the app server's.
     * Every later "is this hold still live?" check compares against Postgres's
     * now(); if a Vercel instance's clock ran forty seconds fast, its holds
     * would expire forty seconds early for reasons no log would ever explain.
     *
     * now() is the transaction start time and is stable for its whole duration,
     * so all four seats in one request expire on exactly the same instant.
     */
    const clock = await tx.execute<{ now: string | Date }>(sql`select now() as now`);
    /* Coerced explicitly. A raw `execute` bypasses Drizzle's column mapping, so
       the timestamp arrives in whatever shape the driver hands back rather than
       as a Date - unlike the typed `.select()` below, which is mapped. */
    const expiresAt = new Date(
      new Date(clock[0].now).getTime() + HOLD_MINUTES * 60_000,
    );

    if (toInsert.length > 0) {
      await tx
        .insert(holds)
        .values(toInsert.map((seatId) => ({ seatId, userId, expiresAt })));

      /* The render cache, written but never read for a decision. Kept current
         so the seat map can paint 288 seats without joining two tables. */
      await tx
        .update(seats)
        .set({ status: "held" })
        .where(inArray(seats.id, toInsert));
    }

    /* ── 9. BUILD THE RESPONSE ───────────────────────────────────────────
     *
     * Prices come from `sections`, never from the client. The total is
     * recomputed server-side here for the same reason it will be at checkout:
     * a price that arrived in a request body is a price the buyer chose.
     */
    const detail = await tx
      .select({
        holdId: holds.id,
        seatId: seats.id,
        sectionName: sections.name,
        rowLabel: seats.rowLabel,
        seatNo: seats.seatNo,
        priceCents: sections.priceCents,
        expiresAt: holds.expiresAt,
      })
      .from(holds)
      .innerJoin(seats, eq(seats.id, holds.seatId))
      .innerJoin(sections, eq(sections.id, seats.sectionId))
      .where(
        and(
          inArray(holds.seatId, seatIds),
          eq(holds.userId, userId),
          isNull(holds.releasedAt),
        ),
      )
      .orderBy(sections.priceCents, seats.rowLabel, seats.seatNo);

    return {
      eventId,
      seats: detail.map((row) => ({
        holdId: row.holdId,
        seatId: row.seatId,
        sectionName: row.sectionName,
        rowLabel: row.rowLabel,
        seatNo: row.seatNo,
        priceCents: row.priceCents,
      })),
      /* The earliest expiry across the set. With one transaction they are
         identical, but a replay can mix an older hold with a new one, and the
         countdown must show the one that runs out first. */
      expiresAt: detail.reduce(
        (soonest, row) => (row.expiresAt < soonest ? row.expiresAt : soonest),
        expiresAt,
      ),
      totalCents: calculateTotalCents(detail),
      replayed: toInsert.length === 0,
    };
  });
}

/* ── reading holds back ─────────────────────────────────────────────────── */

/**
 * The caller's live holds on one event, or null when they have none.
 *
 * ── WHY THIS EXISTS: THE COUNTDOWN HAS TO SURVIVE A REFRESH ────────────────
 * The hold lives for ten minutes in Postgres, but the timer showing it lived
 * only in React state - so one F5 and the buyer saw nothing, while the database
 * quietly held their seats for another nine minutes. They would reasonably
 * assume the hold was gone and start again.
 *
 * ── WHY POSTGRES AND NOT localStorage ──────────────────────────────────────
 * localStorage is the obvious fix and the wrong one. It is a second copy of
 * state the database already owns, and it can outlive the thing it describes:
 * close the tab, come back twenty minutes later, and a cached `expiresAt` will
 * happily count down seats that were released long ago. The user watches a
 * timer for tickets they do not have.
 *
 * Reading it back is authoritative, correct across tabs and devices, and cannot
 * describe a hold that no longer exists - because the same `holdIsLive` that
 * decides availability everywhere else decides it here too.
 *
 * The shape matches what POST /api/holds returns on success, so the client
 * seeds its state from either source without knowing which it got.
 */
export async function getActiveHoldsForUser(
  userId: string,
  eventId: string,
): Promise<HoldResult | null> {
  const rows = await db
    .select({
      holdId: holds.id,
      seatId: seats.id,
      sectionName: sections.name,
      rowLabel: seats.rowLabel,
      seatNo: seats.seatNo,
      priceCents: sections.priceCents,
      expiresAt: holds.expiresAt,
    })
    .from(holds)
    .innerJoin(seats, eq(seats.id, holds.seatId))
    .innerJoin(sections, eq(sections.id, seats.sectionId))
    .where(
      and(
        eq(holds.userId, userId),
        eq(seats.eventId, eventId),
        sql`${holdIsLive(sql`${holds}`)}`,
      ),
    )
    .orderBy(sections.priceCents, seats.rowLabel, seats.seatNo);

  if (rows.length === 0) return null;

  return {
    eventId,
    seats: rows.map((row) => ({
      holdId: row.holdId,
      seatId: row.seatId,
      sectionName: row.sectionName,
      rowLabel: row.rowLabel,
      seatNo: row.seatNo,
      priceCents: row.priceCents,
    })),
    /* The EARLIEST expiry across the set. A user can hold seats from two
       separate requests, and the countdown must show whichever runs out first -
       showing the later one would promise time they do not have. */
    expiresAt: rows.reduce(
      (soonest, row) => (row.expiresAt < soonest ? row.expiresAt : soonest),
      rows[0].expiresAt,
    ),
    totalCents: calculateTotalCents(rows),
    /* Nothing was created by reading. */
    replayed: true,
  };
}

/* ── releasing ──────────────────────────────────────────────────────────── */

/**
 * Repair `seats.status` for seats that no longer carry a live hold.
 *
 * `createHold` writes `status = 'held'`, so anything that ends a hold has to
 * clear it or the cache stays wrong forever. Availability does not depend on
 * this - T22 made that a read-time decision over `order_items` and live holds -
 * but a cache nobody maintains is just a misleading column, and the next person
 * to read the table will believe it.
 *
 * Guarded by `seatIsSold` so a seat with an order line can never be flipped
 * back to available by a stray hold row. Sold is permanent; held is not.
 */
async function repairSeatStatus(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  seatIds: string[],
): Promise<number> {
  if (seatIds.length === 0) return 0;

  const repaired = await tx.execute<{ id: string }>(sql`
    update ${seats} st
    set status = 'available'
    where st.id in ${seatIds}
      and st.status <> 'available'
      and not ${seatIsSold(sql`st.id`)}
    returning st.id
  `);
  return repaired.length;
}

/**
 * Hand seats back voluntarily.
 *
 * ── OWNERSHIP IS ENFORCED IN THE WHERE CLAUSE ──────────────────────────────
 * `user_id = ${userId}` sits in the UPDATE itself rather than in a fetch-then-
 * check above it. A row belonging to someone else simply does not match, so
 * there is no branch to get wrong and no gap between reading and writing for a
 * concurrent request to slip through. The strongest version of an authorisation
 * rule is one the database applies, not one the application remembers to.
 *
 * ── IDEMPOTENT ─────────────────────────────────────────────────────────────
 * Releasing seats that were already released, or already expired, updates
 * nothing and returns zero. The caller's intent - "I do not want these" - is
 * satisfied either way, so a retry after a dropped connection must not look
 * like a failure.
 */
export async function releaseHolds({
  userId,
  seatIds,
}: {
  userId: string;
  seatIds: string[];
}): Promise<{ released: string[]; statusRepaired: number }> {
  if (seatIds.length === 0) return { released: [], statusRepaired: 0 };

  return db.transaction(async (tx) => {
    const rows = await tx
      .update(holds)
      .set({ releasedAt: sql`now()` })
      .where(
        and(
          inArray(holds.seatId, seatIds),
          eq(holds.userId, userId),
          isNull(holds.releasedAt),
        ),
      )
      .returning({ seatId: holds.seatId });

    const released = rows.map((r) => r.seatId);
    const statusRepaired = await repairSeatStatus(tx, released);

    return { released, statusRepaired };
  });
}

/**
 * The cron job's whole body: mark expired holds as released.
 *
 * ── THIS IS HOUSEKEEPING AND MUST STAY THAT WAY ────────────────────────────
 * Nothing depends on it running. A hold past `expires_at` already frees its
 * seat, in the query, the instant it passes - that is T22, and it is what makes
 * the ten-minute promise honest even if this job never runs again.
 *
 * What it actually buys is tidiness. A seat whose hold expired and which nobody
 * re-requested keeps a row with `released_at IS NULL` and a stale
 * `seats.status = 'held'` indefinitely. Neither is wrong in any way a user can
 * see; both are wrong in a way that would mislead the next person reading the
 * database.
 *
 * If this function ever grows a line that changes what "available" means, T22's
 * guarantee has quietly become a lie and the seat map starts depending on a
 * daily job to be correct.
 */
export async function releaseExpiredHolds(): Promise<{
  released: number;
  statusRepaired: number;
}> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(holds)
      .set({ releasedAt: sql`now()` })
      .where(and(isNull(holds.releasedAt), lte(holds.expiresAt, sql`now()`)))
      .returning({ seatId: holds.seatId });

    const seatIds = [...new Set(rows.map((r) => r.seatId))];
    const statusRepaired = await repairSeatStatus(tx, seatIds);

    return { released: rows.length, statusRepaired };
  });
}

/* ── postgres error mapping ─────────────────────────────────────────────── */

/**
 * True for a unique violation on the live-hold index - layer 2 firing.
 *
 * ── FIXED IN T28: THIS NEVER MATCHED ──────────────────────────────────────
 * Both of these used to read `(error as PgError).code` off the top level of
 * whatever was thrown. Drizzle does not throw the driver's error though - it
 * throws a `DrizzleQueryError` and hangs the `PostgresError` (the one actually
 * carrying `code` and `constraint_name`) on `.cause`. So `code` was always
 * `undefined`, both functions were always false, and the carefully written
 * 409 and 503 branches in the route handler were dead code.
 *
 * This is visible in T21's own negative-control output. With `.for("update")`
 * removed, it reported "Server Errors: 15" - those fifteen were
 * `one_live_hold_per_seat` doing exactly its job, but because the code could
 * not be read they fell through to the generic 500 "Could not hold those
 * seats" instead of the honest 409 "Someone just took that seat." The
 * database was always right; the error mapping was discarding its answer.
 *
 * `isUniqueViolation` walks the cause chain. See src/db/pg-error.ts.
 */
export function isLiveHoldViolation(error: unknown): boolean {
  return isUniqueViolation(error, "one_live_hold_per_seat");
}

/** True for a Postgres deadlock. Should be unreachable given the lock ordering. */
export function isDeadlock(error: unknown): boolean {
  return isDeadlockError(error);
}
