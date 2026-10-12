/**
 * T42 — one-time (and safely re-runnable) setup for the k6 load test.
 *
 *   node --env-file=.env.local scripts/seed-load-test.ts [userCount]
 *
 * Creates everything `loadtest/holds.js` needs and nothing it doesn't:
 *
 *   1. A DEDICATED event with exactly 100 seats, isolated from every other
 *      event in the database. Reusing a real seeded event's seats would mean
 *      "no seat has more than one live hold" is being checked against a pool
 *      other test runs have already partially sold or held - the assertion
 *      would be true for the wrong reason. A fresh, uncontaminated 100-seat
 *      pool is what makes the post-run check mean something.
 *   2. 500 REAL Supabase Auth accounts (not the `@rush.demo` seed buyers,
 *      which `grant-role.ts` already notes have no auth credentials at all -
 *      500 real sessions need 500 real accounts that can actually sign in).
 *   3. 500 captured session cookies, written to `loadtest/sessions.json`.
 *
 * ── WHY THE COOKIES ARE CAPTURED HERE, NOT INSIDE k6 ───────────────────────
 * k6 scripts run in a sandboxed Goja JS runtime - no npm, no `@supabase/ssr`.
 * Authenticating 500 users has to happen in real Node, once, ahead of time.
 * This reuses `rbac-test.mjs`'s exact technique: a real `signInWithPassword()`
 * against a capturing in-memory cookie jar, which returns byte-for-byte what
 * a browser would send - no hand-rolled cookie format to get subtly wrong
 * and silently 401 every request during the timed run.
 *
 * ── WHY `public.users` NEEDS NO EXTRA CODE HERE ────────────────────────────
 * Migration 0002's `on_auth_user_created` trigger fires on ANY insert into
 * `auth.users`, including ones made through the admin API - it mirrors every
 * new account into `public.users` with `role = 'buyer'` inside the SAME
 * transaction, which is the whole reason that trigger exists rather than
 * application code doing the insert. Nothing here touches `public.users`
 * directly.
 *
 * ── WHY THIS IS SAFE TO RE-RUN ──────────────────────────────────────────── *
 * `createUser` on an email that already exists fails loudly and is treated
 * as "already provisioned" rather than an error - the password from the
 * FIRST run is still what the account has, and this script always uses the
 * same deterministic password, so signing in still works. The event/seats
 * are looked up by the fixture's own marker title before ever being created.
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import fs from "node:fs";

import { closeDb, db } from "../src/db";
import { events, sections, seats, venues } from "../src/db/schema";
import { eq } from "drizzle-orm";

const FIXTURE_TITLE = "LOAD TEST — do not delete";
const SEAT_COUNT = 100;
const ORGANIZER_ID = "00000000-0000-4000-8000-000000000001";

const USER_COUNT = Number(process.argv[2]) || 500;
/** Every load-test account shares this - they are throwaway fixtures, not
 *  real credentials, and a shared password means the sign-in step needs no
 *  per-user secret storage beyond the deterministic email. */
const PASSWORD = "loadtest-fixture-password-not-real";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
      "SUPABASE_SERVICE_ROLE_KEY must all be set in .env.local",
  );
}

/** The admin client - service role, bypasses RLS, can create auth users.
 *  Never imported by anything that ships to the browser. */
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function emailFor(i: number): string {
  return `loadtest-${String(i).padStart(4, "0")}@rush.test`;
}

/** One admin-created account. Treats "already registered" as success,
 *  since re-running this script must not fail just because a previous run
 *  already provisioned this exact user. */
async function ensureUser(email: string): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error && !/already.*registered|already.*exists/i.test(error.message)) {
    throw new Error(`createUser(${email}) failed: ${error.message}`);
  }
}

/**
 * Real sign-in, real cookie jar - see the module note on why this is not a
 * hand-rolled token format. Mirrors `rbac-test.mjs`'s `sessionCookie()`.
 *
 * ── RETRIES, BECAUSE SUPABASE'S OWN AUTH RATE LIMIT IS TIGHTER THAN THE
 *    ADMIN API'S ────────────────────────────────────────────────────────
 * Found empirically: `createUser` tolerated 15-way concurrency across 500
 * calls without complaint, but `signInWithPassword` at the same concurrency
 * started failing with "Request rate limit reached" around the 30th call.
 * The sign-in endpoint is throttled harder than user creation - reasonably,
 * since it is the one a real attacker would want to hammer.
 *
 * ── THE FIRST VERSION OF THIS RETRY MADE THE PROBLEM WORSE, NOT BETTER ────
 * A fixed `attempt * 1500ms` backoff with no randomness means every worker
 * that gets rate-limited in the same instant backs off on the IDENTICAL
 * schedule and retries in the SAME instant too - five workers colliding,
 * backing off together, then colliding again on the next attempt. Measured:
 * a run with that backoff still exhausted all 8 retries and failed outright
 * around user 107, never recovering. Full jitter (`random() * cap`, not
 * `attempt * fixed`) is what actually breaks the lockstep - each worker
 * backs off a different, unpredictable amount, so they stop retrying in
 * unison and the shared limit actually gets a chance to clear.
 */
async function sessionCookie(email: string, attempt = 1): Promise<string> {
  const jar = new Map<string, string>();
  const sb = createServerClient(supabaseUrl!, anonKey!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });

  if (error) {
    if (/rate limit/i.test(error.message) && attempt <= 12) {
      const cap = Math.min(2000 * 2 ** attempt, 30_000);
      await new Promise((r) => setTimeout(r, Math.random() * cap));
      return sessionCookie(email, attempt + 1);
    }
    throw new Error(`sign-in failed for ${email}: ${error.message}`);
  }
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

/** Runs `count` async jobs with at most `limit` in flight at once - plain
 *  Promise.all for 500 Supabase Auth API calls risks tripping a provider-side
 *  rate limit that a blind full-concurrency burst can't distinguish from a
 *  real failure. */
async function pool<T>(count: number, limit: number, worker: (i: number) => Promise<T>) {
  const results: T[] = new Array(count);
  let next = 0;
  async function run() {
    while (next < count) {
      const i = next++;
      results[i] = await worker(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, run));
  return results;
}

async function ensureFixtureEvent(): Promise<{ eventId: string; seatIds: string[] }> {
  const [existingEvent] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.title, FIXTURE_TITLE))
    .limit(1);

  let eventId: string;

  if (existingEvent) {
    eventId = existingEvent.id;
    console.log(`  fixture event already exists: ${eventId}`);
  } else {
    const [venue] = await db
      .insert(venues)
      .values({ name: "Load Test Venue", city: "Load Test City" })
      .returning();

    const [event] = await db
      .insert(events)
      .values({
        title: FIXTURE_TITLE,
        description: "Created by scripts/seed-load-test.ts. Safe to leave in place.",
        venueId: venue.id,
        organizerId: ORGANIZER_ID,
        dropAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // dropped a day ago
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: "live",
      })
      .returning();
    eventId = event.id;

    const [section] = await db
      .insert(sections)
      .values({ eventId, name: "General", priceCents: 50000 })
      .returning();

    /* Exactly 100: 10 rows of 10. One section, one price - the pool's shape
       should not matter to a test that is only about contention on seat_id. */
    const seatRows = Array.from({ length: 10 }, (_, row) =>
      Array.from({ length: 10 }, (_, seatNo) => ({
        eventId,
        sectionId: section.id,
        rowLabel: String.fromCharCode(65 + row), // A..J
        seatNo: seatNo + 1,
      })),
    ).flat();

    await db.insert(seats).values(seatRows);
    console.log(`  created fixture event: ${eventId} (${seatRows.length} seats)`);
  }

  const seatRows2 = await db
    .select({ id: seats.id })
    .from(seats)
    .where(eq(seats.eventId, eventId));

  if (seatRows2.length !== SEAT_COUNT) {
    throw new Error(
      `fixture event has ${seatRows2.length} seats, expected ${SEAT_COUNT} - ` +
        "delete it and re-run if the shape ever needs to change",
    );
  }

  return { eventId, seatIds: seatRows2.map((s) => s.id) };
}

async function main() {
  console.log(`\n1. The fixture event (${SEAT_COUNT} seats)`);
  const { eventId, seatIds } = await ensureFixtureEvent();

  console.log(`\n2. Provisioning ${USER_COUNT} Supabase Auth accounts (concurrency 15)`);
  let created = 0;
  await pool(USER_COUNT, 15, async (i) => {
    await ensureUser(emailFor(i + 1));
    created++;
    if (created % 100 === 0) console.log(`      ${created}/${USER_COUNT}`);
  });
  console.log(`      done: ${USER_COUNT} accounts provisioned (or already existed)`);

  console.log(`\n3. Signing in all ${USER_COUNT} and capturing session cookies (concurrency 5)`);
  /* Lower than step 2's 15 - found empirically that signInWithPassword hits
     Supabase's own auth rate limit around 15-way concurrency, well before
     createUser does. Dropped further, to 3, after a run at 5 still
     exhausted every retry - see the jittered-backoff note on
     `sessionCookie` for why 5 colliding workers made the limit WORSE, not
     better, until the backoff stopped being deterministic. */
  let signedIn = 0;
  const cookies = await pool(USER_COUNT, 3, async (i) => {
    const cookie = await sessionCookie(emailFor(i + 1));
    signedIn++;
    if (signedIn % 100 === 0) console.log(`      ${signedIn}/${USER_COUNT}`);
    return cookie;
  });

  const fixture = {
    eventId,
    seatIds,
    cookies,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync("loadtest/fixture.json", JSON.stringify(fixture));

  console.log(
    `\n  Wrote loadtest/fixture.json - event ${eventId}, ${seatIds.length} seats, ` +
      `${cookies.length} session cookies.\n`,
  );
  console.log("  Run the load test with: npm run loadtest\n");
}

main()
  .catch((error) => {
    console.error("\n  FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
