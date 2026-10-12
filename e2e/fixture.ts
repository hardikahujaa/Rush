/**
 * The dedicated event `purchase-flow.spec.ts` buys a seat from.
 *
 * A fresh, isolated event - not a reused seed/demo event - for the same
 * reason T42's load test used a dedicated "LOAD TEST" event rather than
 * seed data: a shared pool that other runs/scripts might have partially
 * sold or held would make "a seat was available to buy" true for the wrong
 * reason. Mirrors `scripts/seed-load-test.ts`'s fixture shape, just much
 * smaller - one section, four seats, nothing this test doesn't use.
 */
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/db/schema";
import { events, orders, sections, seats, venues } from "../src/db/schema";

export const FIXTURE_TITLE = "E2E TEST — purchase-flow — safe to delete";
const ORGANIZER_ID = "00000000-0000-4000-8000-000000000001";

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * A connection scoped to ONE call, opened and closed within it - not
 * `src/db`'s shared, `globalThis`-cached pool.
 *
 * That pool is cached for Next's dev-mode hot reload, which doesn't apply
 * here; sharing it across `globalSetup` and `globalTeardown` (same Node
 * process, per Playwright) caused `globalTeardown` to inherit whatever
 * state `globalSetup` had already left it in. Opening fresh and closing
 * fully before returning avoids that, and avoids leaving any socket open
 * for Playwright's own forced process exit to race against.
 */
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set in .env.local");

  const conn = postgres(connectionString, { prepare: false, max: 1 });
  try {
    return await fn(drizzle(conn, { schema }));
  } finally {
    await conn.end({ timeout: 5 });
  }
}

export async function ensureFixtureEvent(): Promise<void> {
  await withDb(async (db) => {
    const [existing] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.title, FIXTURE_TITLE))
      .limit(1);

    if (existing) return;

    const [venue] = await db
      .insert(venues)
      .values({ name: "E2E Fixture Venue", city: "E2E City" })
      .returning();

    const [event] = await db
      .insert(events)
      .values({
        title: FIXTURE_TITLE,
        description: "Created by e2e/global-setup.ts. Safe to leave in place.",
        venueId: venue.id,
        organizerId: ORGANIZER_ID,
        dropAt: new Date(Date.now() - 60 * 60 * 1000), // already dropped
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: "live",
      })
      .returning();

    const [section] = await db
      .insert(sections)
      .values({ eventId: event.id, name: "General", priceCents: 50000 })
      .returning();

    await db.insert(seats).values(
      Array.from({ length: 4 }, (_, i) => ({
        eventId: event.id,
        sectionId: section.id,
        rowLabel: "A",
        seatNo: i + 1,
      })),
    );
  });
}

export async function deleteFixtureEvent(): Promise<void> {
  const buyerIds = await withDb(async (db) => {
    const [existing] = await db
      .select({ id: events.id, venueId: events.venueId })
      .from(events)
      .where(eq(events.title, FIXTURE_TITLE))
      .limit(1);

    if (!existing) return [];

    /* A real purchase during the run leaves a real `orders` row, and
       `orders.event_id -> events` is "restrict" (CLAUDE.md: a financial
       record is never silently discarded) - so it has to go before the
       event can. Deleting it cascades `order_items` and `tickets` for
       free. */
    const orderRows = await db
      .select({ id: orders.id, userId: orders.userId })
      .from(orders)
      .where(eq(orders.eventId, existing.id));

    if (orderRows.length > 0) {
      await db.delete(orders).where(eq(orders.eventId, existing.id));
    }

    // sections/seats/holds cascade from events; events -> venues is
    // "restrict", so the venue is deleted last.
    await db.delete(events).where(eq(events.id, existing.id));
    await db.delete(venues).where(eq(venues.id, existing.venueId));

    return [...new Set(orderRows.map((r) => r.userId))];
  });

  await deleteBuyerAccounts(buyerIds);
}

/**
 * Remove the throwaway buyer account(s) the run's signup step created.
 *
 * Best-effort: each run uses a unique email, so leftover accounts never
 * break a future run - this is tidiness, not correctness, so a failure here
 * is logged and swallowed rather than failing the whole teardown.
 */
async function deleteBuyerAccounts(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const userId of userIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.warn(`[e2e] could not delete buyer ${userId}: ${error.message}`);
  }
}
