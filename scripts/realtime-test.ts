/**
 * T33 verification — Realtime on `seats`, and the grant hardening beside it.
 *
 *   npm run realtime-test
 *
 * ── WHY THIS SUBSCRIBES WITH THE ANON KEY ──────────────────────────────────
 * Every other script in this repo talks to Postgres through Drizzle on the
 * `postgres` role, which has `rolbypassrls = true` - so it can neither prove nor
 * disprove anything about RLS. A browser subscribes as `anon`, and Realtime
 * enforces the policy. Testing this any other way would assert that the code
 * compiles, not that a seat map in a real browser receives anything.
 *
 * So section 2 opens a genuine socket with the public anon key, commits a hold
 * through the real `createHold`, and waits for the event to arrive.
 *
 * SAFE ON REAL DATA. The hold it creates is released and the seat restored in
 * the finally block.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";

import { db } from "../src/db";
import { events, holds, seats, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold, releaseHolds } from "../src/db/queries/holds";
import { getSeatMapForEvent } from "../src/db/queries/seats";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

const touched: string[] = [];

async function main() {
  if (!url || !anonKey) throw new Error("Supabase URL/anon key missing from .env.local");

  const [event] = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  if (!event) throw new Error("no live event");

  const [buyer] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(1);

  console.log(`\n  Event : ${event.title}`);
  console.log(`  Key   : anon (RLS enforced)\n`);

  /* ── 1. the plumbing exists ───────────────────────────────────────────── */
  console.log("1. Database configuration");

  const pub = await db.execute<{ tablename: string }>(sql`
    select tablename from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'`);
  const pubTables = pub.map((r) => r.tablename);
  check("`seats` is in the supabase_realtime publication", pubTables.includes("seats"));
  check(
    "`holds` is NOT published (its rows carry user_id)",
    !pubTables.includes("holds"),
    "a hold row would be broadcast to every browser",
  );

  const pol = await db.execute<{ tablename: string; cmd: string }>(sql`
    select tablename, cmd from pg_policies where schemaname = 'public'`);
  check(
    "`seats` has a SELECT policy",
    pol.some((p) => p.tablename === "seats" && p.cmd === "SELECT"),
  );
  check(
    "and it is SELECT-only — no policy grants write on seats",
    !pol.some((p) => p.tablename === "seats" && p.cmd !== "SELECT"),
    "a FOR ALL policy would let anon rewrite the seat map",
  );

  /* ── 2. THE PROOF: an event reaches an anon subscriber ────────────────── */
  console.log("\n2. A real subscription, as anon, receives a real hold");

  const free = await db.execute<{ id: string }>(sql`
    select st.id from ${seats} st
    where st.event_id = ${event.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id limit 1`);
  const seatId = free[0].id;
  touched.push(seatId);

  const supabase = createClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: 20 } },
  });

  const received: { id: string; status: string }[] = [];
  let subscribed = false;

  const channel = supabase
    .channel(`test:seats:${event.id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "seats",
        filter: `event_id=eq.${event.id}`,
      },
      (payload) => {
        const row = payload.new as { id?: string; status?: string };
        if (row?.id && row.status) received.push({ id: row.id, status: row.status });
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") subscribed = true;
    });

  /* Wait for the socket, rather than assuming it connected. */
  const connectDeadline = Date.now() + 10_000;
  while (!subscribed && Date.now() < connectDeadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  check("the anon client reaches SUBSCRIBED", subscribed, "never connected in 10s");

  /**
   * ── THE SETTLE IS NOT PADDING. IT IS THE FINDING. ────────────────────────
   * Supabase reports `SUBSCRIBED` before the server-side change feed is armed
   * for the filter. Measured here: without this wait, a hold committed straight
   * after the callback was NEVER delivered, while the next write on the same
   * channel arrived in 484ms. With the wait, the same hold arrived in 1049ms.
   *
   * A change lost in that window is the dangerous kind - no event means no
   * resync, so the map stays wrong with nothing left to correct it. That is why
   * `seat-map.tsx` resyncs on the FIRST subscribe too, and why removing this
   * line would make the test flaky rather than make it stricter.
   */
  const SETTLE_MS = 2500;
  await new Promise((r) => setTimeout(r, SETTLE_MS));

  if (subscribed) {
    await createHold({ userId: buyer.id, seatIds: [seatId] });

    const started = Date.now();
    const eventDeadline = started + 10_000;
    while (!received.some((r) => r.id === seatId) && Date.now() < eventDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const hit = received.find((r) => r.id === seatId);
    const elapsed = Date.now() - started;

    check(
      "the hold arrives over the socket",
      Boolean(hit),
      "no event in 10s — the publication or the policy is not working",
    );
    check("and it says the seat is now held", hit?.status === "held", hit?.status ?? "none");
    if (hit) console.log(`      ↳ delivered in ${elapsed} ms`);

    /* The release is the other direction, and it is what the second browser
       window in the T33 demo sees when a hold is given back. */
    received.length = 0;
    await releaseHolds({ userId: buyer.id, seatIds: [seatId] });

    const relDeadline = Date.now() + 10_000;
    while (!received.some((r) => r.id === seatId) && Date.now() < relDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const rel = received.find((r) => r.id === seatId);
    check("a release arrives too", Boolean(rel));
    check("and it says the seat is available again", rel?.status === "available", rel?.status ?? "none");
  }

  await supabase.removeChannel(channel);

  /* ── 3. the transition Realtime CANNOT deliver ────────────────────────── */
  console.log("\n3. Lazy expiry: the gap the socket cannot cover");

  await createHold({ userId: buyer.id, seatIds: [seatId] });
  const mapHeld = await getSeatMapForEvent(event.id);
  const heldSeat = mapHeld!.seats.find((s) => s.id === seatId)!;

  check("a held seat is sent with its hold's expiry", Boolean(heldSeat.holdExpiresAt));
  check(
    "which is ~10 minutes out, matching createHold",
    heldSeat.holdExpiresAt
      ? Math.abs((new Date(heldSeat.holdExpiresAt).getTime() - Date.now()) / 60000 - 10) < 1
      : false,
  );

  /* Force the hold into the past. This writes `holds`, NOT `seats` - which is
     exactly why no realtime event can describe it. */
  await db
    .update(holds)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(eq(holds.seatId, seatId));

  const seatRow = await db
    .select({ status: seats.status })
    .from(seats)
    .where(eq(seats.id, seatId))
    .limit(1);
  check(
    "`seats.status` still reads 'held' after expiry — no row changed",
    seatRow[0].status === "held",
  );
  console.log("      ↳ so Postgres emits nothing, and the socket stays silent.");

  const mapExpired = await getSeatMapForEvent(event.id);
  const expiredSeat = mapExpired!.seats.find((s) => s.id === seatId)!;
  check(
    "but the server already reports it available (T22 lazy expiry)",
    expiredSeat.status === "available",
  );
  check(
    "and its expiry is null, so nothing is left for the client to count down",
    expiredSeat.holdExpiresAt === null,
  );
  console.log("      ↳ which is why the client applies the expiry locally:");
  console.log("        held + expires_at in the past = available, decided at render.");

  /* ── 4. the hardening: anon cannot write ─────────────────────────────── */
  console.log("\n4. Grant hardening (anon is read-only)");

  const anon = createClient(url, anonKey);

  const { error: updErr } = await anon
    .from("seats")
    .update({ status: "sold" })
    .eq("id", seatId);
  check(
    "anon UPDATE on seats is refused",
    updErr !== null,
    "ANON CAN REWRITE THE SEAT MAP",
  );

  const { error: insErr } = await anon.from("orders").insert({
    user_id: buyer.id,
    event_id: event.id,
    total_cents: 0,
  } as never);
  check("anon INSERT on orders is refused", insErr !== null, "ANON CAN CREATE ORDERS");

  /* Reads of the private tables must still be denied - the migration added one
     policy, and only one. */
  for (const table of ["orders", "tickets", "users", "holds"]) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    check(
      `anon SELECT on ${table} returns nothing`,
      error !== null || (data?.length ?? 0) === 0,
      `${data?.length ?? 0} rows leaked`,
    );
  }

  /* And the one table that IS readable, is readable - otherwise realtime could
     not work and section 2 passing would be inexplicable. */
  const { data: seatRead, error: seatErr } = await anon
    .from("seats")
    .select("id,status")
    .limit(1);
  check(
    "anon SELECT on seats DOES work (realtime depends on it)",
    seatErr === null && (seatRead?.length ?? 0) === 1,
    seatErr?.message ?? "no rows",
  );
}

async function cleanup() {
  if (touched.length) {
    await db.delete(holds).where(inArray(holds.seatId, touched));
    await db.update(seats).set({ status: "available" }).where(inArray(seats.id, touched));
  }
  console.log(`\n  cleanup: ${touched.length} seat(s) restored.`);
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
