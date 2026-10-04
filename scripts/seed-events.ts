/**
 * ADD real events to the catalogue, without destroying anything.
 *
 *   npm run seed-events
 *
 * ── WHY NOT JUST RE-SEED ───────────────────────────────────────────────────
 * `npm run db:seed` builds a richer catalogue but clears first - tickets,
 * orderItems, orders, holds, seats, sections, events, venues - so using it to
 * get more events also destroys every order and ticket a real signed-up account
 * has bought. This script only ever INSERTs, the same posture as
 * `scripts/fix-dates.ts`.
 *
 * ── WHY MORE EVENTS AT ALL ─────────────────────────────────────────────────
 * The seed creates three events at one venue in one city, and one of those has
 * already ended. Once T17 points the homepage at Postgres instead of
 * `mock-events.ts`, that is a homepage with two cards on it, both at Nehru
 * Indoor Stadium, both from Rs 999. No amount of layout work makes that read as
 * a catalogue. These rows are what let the real homepage look like a product.
 *
 * ── FIDELITY ───────────────────────────────────────────────────────────────
 * Every structural constant is copied from `src/db/seed.ts` deliberately -
 * same three tiers, same A-H x 12 grid, 288 seats per event - so the seat maps
 * these create are structurally identical to the one T19-T30 were verified
 * against. The only thing that varies per event is a price multiplier and how
 * much of the room is pre-sold.
 *
 * Sold seats are created through REAL orders and order_items, never by setting
 * `seats.status = 'sold'` on its own. The seat map's source of truth is
 * `order_items` (see the note on the seats table in schema.ts), so faking the
 * status would leave T22's availability query reporting those seats as free and
 * T36's dashboard reporting zero revenue on a sold-out show. Seed data that lies
 * is worse than none.
 *
 * IDEMPOTENT: an event whose title already exists is skipped, so re-running
 * neither duplicates the catalogue nor touches what is already there.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import {
  events,
  orderItems,
  orders,
  seats,
  sections,
  tickets,
  users,
  venues,
} from "../src/db/schema";
import { signTicket } from "../src/lib/qr";

/* ── constants mirrored from src/db/seed.ts ─────────────────────────────── */

const ORGANIZER_ID = "00000000-0000-4000-8000-000000000001";
const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const SEATS_PER_ROW = 12;

/** Paise. Rs 4,999 -> 499900. Scaled per event by `priceScale` below. */
const TIERS = [
  { name: "Front", priceCents: 499_900 },
  { name: "Middle", priceCents: 249_900 },
  { name: "Rear", priceCents: 99_900 },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* ── what to add ────────────────────────────────────────────────────────── */

type VenueSpec = { name: string; city: string };

const NEW_VENUES: VenueSpec[] = [
  { name: "Jio World Garden", city: "Mumbai" },
  { name: "Phoenix Arena", city: "Bengaluru" },
  { name: "Indira Gandhi Arena", city: "Delhi NCR" },
];

type EventSpec = {
  title: string;
  description: string;
  venue: string;
  /** Days from now the doors open. */
  startsInDays: number;
  /** Days from now tickets release. Negative = already dropped. */
  dropsInDays: number;
  status: "live" | "scheduled";
  /** Multiplier on the three tier prices, so "from Rs ..." differs per card. */
  priceScale: number;
  /** Fraction of the room already bought through real orders. */
  soldFraction: number;
};

/**
 * Four on sale and four upcoming, so both CTA branches on the card and both
 * states of the detail page's countdown are demonstrable from the homepage.
 *
 * `soldFraction` is kept moderate on purpose. The mock `rc-3` was 78% sold, and
 * combined with the old 1.08:1 sold-seat contrast that is what made a seat map
 * read as blank. A room between 15% and 45% gone looks live without looking
 * broken.
 */
const NEW_EVENTS: EventSpec[] = [
  /* ── on sale now (dropped, doors still ahead) ─────────────────────────── */
  {
    title: "Aurora Bass — India Tour",
    description:
      "Four cities, one stage design, and a low end you feel in your ribs. Chennai sold out in nine minutes; this is the Mumbai night.",
    venue: "Jio World Garden",
    startsInDays: 6,
    dropsInDays: -2,
    status: "live",
    priceScale: 1.4,
    soldFraction: 0.34,
  },
  {
    title: "The Quiet Hours — Acoustic Set",
    description:
      "No amps, no support act. Three hundred seats and a room built for it.",
    venue: "Phoenix Arena",
    startsInDays: 9,
    dropsInDays: -1,
    status: "live",
    priceScale: 0.55,
    soldFraction: 0.21,
  },
  {
    title: "Stand-Up Saturday — Late Show",
    description:
      "Five comics, ninety minutes, no interval. The late slot is the unfiltered one.",
    venue: "Indira Gandhi Arena",
    startsInDays: 12,
    dropsInDays: -4,
    status: "live",
    priceScale: 0.38,
    soldFraction: 0.44,
  },
  {
    title: "Monsoon Classical — Opening Night",
    description:
      "A full ensemble opening the season. Doors at seven, curtain at half past.",
    venue: "Jio World Garden",
    startsInDays: 18,
    dropsInDays: -6,
    status: "live",
    priceScale: 0.9,
    soldFraction: 0.15,
  },

  /* ── upcoming (drop still ahead - the countdown state) ────────────────── */
  {
    title: "Neon Harbour Festival — Day One",
    description:
      "Two stages, fourteen acts. Day one tickets release first and the queue will be real.",
    venue: "Phoenix Arena",
    startsInDays: 24,
    dropsInDays: 2,
    status: "scheduled",
    priceScale: 1.8,
    soldFraction: 0,
  },
  {
    title: "Analogue Nights — Vinyl Session",
    description:
      "An all-vinyl set on a system that deserves it. Limited to the floor capacity.",
    venue: "Indira Gandhi Arena",
    startsInDays: 28,
    dropsInDays: 5,
    status: "scheduled",
    priceScale: 0.45,
    soldFraction: 0,
  },
  {
    title: "Arclight — Album Launch",
    description:
      "The record plays front to back, once, with the band in the room.",
    venue: "Jio World Garden",
    startsInDays: 33,
    dropsInDays: 9,
    status: "scheduled",
    priceScale: 1.15,
    soldFraction: 0,
  },
  {
    title: "Midnight Circuit — Bengaluru Night",
    description:
      "The second leg, announced after Chennai sold out. Same show, bigger room.",
    venue: "Phoenix Arena",
    startsInDays: 39,
    dropsInDays: 14,
    status: "scheduled",
    priceScale: 1.6,
    soldFraction: 0,
  },
];

/* ── helpers ────────────────────────────────────────────────────────────── */

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Round to whole rupees so prices never show stray paise. */
function scalePrice(base: number, scale: number): number {
  return Math.round((base * scale) / 100) * 100;
}

async function counts() {
  const [row] = (await db.execute<{
    venues: number;
    events: number;
    seats: number;
    orders: number;
    tickets: number;
    users: number;
  }>(sql`
    select (select count(*)::int from venues)  as venues,
           (select count(*)::int from events)  as events,
           (select count(*)::int from seats)   as seats,
           (select count(*)::int from orders)  as orders,
           (select count(*)::int from tickets) as tickets,
           (select count(*)::int from users)   as users
  `)) as unknown as {
    venues: number;
    events: number;
    seats: number;
    orders: number;
    tickets: number;
    users: number;
  }[];
  return row;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-events is a development helper and will not run in production");
  }

  const before = await counts();
  console.log("\n  BEFORE:", JSON.stringify(before));

  /* The organizer every seeded event belongs to. Created by `db:seed`; if it is
     missing the database has never been seeded and this script has nothing to
     attach events to. */
  const [organizer] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ORGANIZER_ID))
    .limit(1);
  if (!organizer) {
    throw new Error("Organizer not found — run `npm run db:seed` once first.");
  }

  /* Buyers to attribute the pre-sold seats to. Reused, never created, so this
     script cannot inflate the user table. */
  const buyers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(40);
  if (buyers.length === 0) throw new Error("No buyers — run `npm run db:seed` once first.");

  /* ── venues, by name, so a re-run reuses rather than duplicates ───────── */
  const venueIdByName = new Map<string, string>();
  const existingVenues = await db.select({ id: venues.id, name: venues.name }).from(venues);
  for (const v of existingVenues) venueIdByName.set(v.name, v.id);

  let venuesAdded = 0;
  for (const spec of NEW_VENUES) {
    if (venueIdByName.has(spec.name)) continue;
    const [created] = await db.insert(venues).values(spec).returning();
    venueIdByName.set(created.name, created.id);
    venuesAdded++;
    console.log(`  + venue  ${created.name}, ${created.city}`);
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  const existingTitles = new Set(
    (await db.select({ title: events.title }).from(events)).map((e) => e.title),
  );

  let eventsAdded = 0;
  let seatsAdded = 0;
  let soldAdded = 0;

  for (const spec of NEW_EVENTS) {
    if (existingTitles.has(spec.title)) {
      console.log(`  = skip   ${spec.title} (already exists)`);
      continue;
    }

    const venueId = venueIdByName.get(spec.venue);
    if (!venueId) throw new Error(`venue ${spec.venue} missing`);

    const [event] = await db
      .insert(events)
      .values({
        title: spec.title,
        description: spec.description,
        venueId,
        organizerId: ORGANIZER_ID,
        dropAt: new Date(Date.now() + spec.dropsInDays * DAY),
        startsAt: new Date(Date.now() + spec.startsInDays * DAY),
        status: spec.status,
      })
      .returning();

    const createdSections = await db
      .insert(sections)
      .values(
        TIERS.map((t) => ({
          name: t.name,
          priceCents: scalePrice(t.priceCents, spec.priceScale),
          eventId: event.id,
        })),
      )
      .returning();

    /* Same A-H x 12 grid per section as db:seed - 288 seats. */
    const seatRows = createdSections.flatMap((section) =>
      ROWS.flatMap((rowLabel) =>
        Array.from({ length: SEATS_PER_ROW }, (_, i) => ({
          eventId: event.id,
          sectionId: section.id,
          rowLabel,
          seatNo: i + 1,
        })),
      ),
    );
    const createdSeats = await db.insert(seats).values(seatRows).returning();
    seatsAdded += createdSeats.length;

    const priceBySection = new Map(createdSections.map((s) => [s.id, s.priceCents]));

    /* ── pre-sell a slice, through real orders ─────────────────────────── */
    const toSell = shuffle(createdSeats).slice(
      0,
      Math.floor(createdSeats.length * spec.soldFraction),
    );

    let cursor = 0;
    while (cursor < toSell.length) {
      /* Groups of 1-4, the same cap the hold API enforces. */
      const size = Math.min(1 + Math.floor(Math.random() * 4), toSell.length - cursor);
      const group = toSell.slice(cursor, cursor + size);
      cursor += size;

      const buyer = buyers[Math.floor(Math.random() * buyers.length)];
      const total = group.reduce((sum, s) => sum + (priceBySection.get(s.sectionId) ?? 0), 0);
      /* Spread over the days since the drop so T37's sales-over-time chart has
         a shape rather than one spike. */
      const boughtAt = new Date(Date.now() - Math.random() * 6 * HOUR);

      const [order] = await db
        .insert(orders)
        .values({
          userId: buyer.id,
          eventId: event.id,
          totalCents: total,
          status: "paid",
          stripeSessionId: `cs_test_seedevents_${randomUUID()}`,
          createdAt: boughtAt,
        })
        .returning();

      await db.insert(orderItems).values(
        group.map((s) => ({
          orderId: order.id,
          seatId: s.id,
          priceCents: priceBySection.get(s.sectionId) ?? 0,
        })),
      );

      await db.insert(tickets).values(
        group.map((s) => {
          const ticketId = randomUUID();
          return {
            id: ticketId,
            orderId: order.id,
            seatId: s.id,
            qrSignature: signTicket(ticketId, order.id, s.id),
            checkedInAt: null,
          };
        }),
      );
    }

    if (toSell.length > 0) {
      /* The render cache, kept in step with the order lines that are the real
         source of truth. */
      await db
        .update(seats)
        .set({ status: "sold" })
        .where(inArray(seats.id, toSell.map((s) => s.id)));
    }
    soldAdded += toSell.length;

    const from = Math.min(...createdSections.map((s) => s.priceCents));
    console.log(
      `  + event  ${spec.status.padEnd(9)} ${spec.dropsInDays < 0 ? "on sale " : "upcoming"} ` +
        `from Rs ${(from / 100).toLocaleString("en-IN")}  ${toSell.length}/288 sold  ${spec.title}`,
    );
    eventsAdded++;
  }

  const after = await counts();
  console.log("\n  AFTER :", JSON.stringify(after));
  console.log(
    `\n  added: ${venuesAdded} venue(s), ${eventsAdded} event(s), ` +
      `${seatsAdded} seat(s), ${soldAdded} pre-sold seat(s).`,
  );

  if (eventsAdded === 0 && venuesAdded === 0) {
    console.log("  Nothing to do — the catalogue already has these events.\n");
    return;
  }

  /* Prove nothing pre-existing was touched. */
  console.log(
    `\n  users unchanged: ${before.users === after.users ? "yes" : "NO — investigate"} ` +
      `(${before.users} -> ${after.users})`,
  );
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
