import { randomUUID } from "node:crypto";

import { inArray, like } from "drizzle-orm";

import { db } from "./index";
import {
  events,
  holds,
  orderItems,
  orders,
  seats,
  sections,
  tickets,
  users,
  venues,
} from "./schema";
import { signTicket } from "../lib/qr";

/**
 * Seed script - `npm run db:seed`.
 *
 * Builds a realistic demo: one venue, three events in three different states,
 * three price tiers each, 288 seats per event, and roughly 20% of them already
 * sold through genuine orders.
 *
 * That last part matters. It would be far easier to mark seats `status: 'sold'`
 * and stop there, but the seat map's real source of truth is `order_items` (see
 * the note on the seats table). Faking the status without the order behind it
 * would leave the lazy-expiry query in T22 reporting those seats as available,
 * and the dashboard in T36 reporting zero revenue on a sold-out show. Seed data
 * that lies is worse than no seed data.
 */

/** Demo accounts are marked by this domain so re-seeding never deletes a real
 *  signed-up user. */
const DEMO_DOMAIN = "@rush.demo";
const ORGANIZER_ID = "00000000-0000-4000-8000-000000000001";

const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const SEATS_PER_ROW = 12;

/** Prices in paise. Rs 4,999 -> 499900. */
const TIERS = [
  { name: "Front", priceCents: 499_900 },
  { name: "Middle", priceCents: 249_900 },
  { name: "Rear", priceCents: 99_900 },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function minutesFromNow(m: number) {
  return new Date(Date.now() + m * MINUTE);
}

/** Deterministic shuffle is not needed here, but a seeded one keeps demo runs
 *  comparable. Plain Fisher-Yates is fine. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function clear() {
  // Order matters: children before parents. `orders` references `events` with
  // onDelete: restrict, so orders must go before the events they point at.
  await db.delete(tickets);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(holds);
  await db.delete(seats);
  await db.delete(sections);
  await db.delete(events);
  await db.delete(venues);
  await db.delete(users).where(like(users.email, `%${DEMO_DOMAIN}`));
}

async function main() {
  console.log("clearing demo data...");
  await clear();

  console.log("seeding...");

  /* -- people ---------------------------------------------------------- */

  await db.insert(users).values({
    id: ORGANIZER_ID,
    email: `organizer${DEMO_DOMAIN}`,
    name: "Demo Organizer",
    role: "organizer",
  });

  const buyers = Array.from({ length: 40 }, (_, i) => ({
    id: randomUUID(),
    email: `buyer${i + 1}${DEMO_DOMAIN}`,
    name: `Demo Buyer ${i + 1}`,
    role: "buyer" as const,
  }));
  await db.insert(users).values(buyers);

  /* -- venue ----------------------------------------------------------- */

  const [venue] = await db
    .insert(venues)
    .values({ name: "Nehru Indoor Stadium", city: "Chennai" })
    .returning();

  /* -- events ---------------------------------------------------------- */

  const eventSpecs = [
    {
      title: "Midnight Circuit — Live in Chennai",
      description:
        "The tour that sold out three cities in under four minutes. One night only, general admission closes when the room is full.",
      dropAt: minutesFromNow(-30), // already dropped
      startsAt: new Date(Date.now() + 3 * DAY),
      status: "live" as const,
    },
    {
      title: "NEON/NOISE Festival — Night One",
      description:
        "Doors at 6pm. Tickets release in a two-minute countdown — this is the one to test the waiting room against.",
      dropAt: minutesFromNow(2), // drops in 2 minutes
      startsAt: new Date(Date.now() + 10 * DAY),
      status: "scheduled" as const,
    },
    {
      title: "Anantara Unplugged — Farewell Show",
      description:
        "Sold out. Archived here so the dashboard has a completed event to report on.",
      dropAt: new Date(Date.now() - 30 * DAY),
      startsAt: new Date(Date.now() - 7 * DAY),
      status: "ended" as const,
    },
  ];

  let totalSeats = 0;
  let totalSold = 0;
  let totalRevenue = 0;

  for (const spec of eventSpecs) {
    const [event] = await db
      .insert(events)
      .values({ ...spec, venueId: venue.id, organizerId: ORGANIZER_ID })
      .returning();

    const createdSections = await db
      .insert(sections)
      .values(TIERS.map((t) => ({ ...t, eventId: event.id })))
      .returning();

    /* -- seats: rows A-H x 12, per section -- */
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
    totalSeats += createdSeats.length;

    const priceBySection = new Map(
      createdSections.map((s) => [s.id, s.priceCents]),
    );

    /* -- sell ~20% of them for real -- */
    // An ended event is fully sold; the scheduled one has not dropped yet so
    // nothing can have been bought.
    const sellFraction =
      spec.status === "ended" ? 1 : spec.status === "scheduled" ? 0 : 0.2;
    const toSell = shuffle(createdSeats).slice(
      0,
      Math.floor(createdSeats.length * sellFraction),
    );

    // Group seats into plausible orders of 1-4 seats, the same cap the hold API
    // enforces in T20.
    let cursor = 0;
    while (cursor < toSell.length) {
      const size = Math.min(
        1 + Math.floor(Math.random() * 4),
        toSell.length - cursor,
      );
      const group = toSell.slice(cursor, cursor + size);
      cursor += size;

      const buyer = buyers[Math.floor(Math.random() * buyers.length)];
      const total = group.reduce(
        (sum, s) => sum + (priceBySection.get(s.sectionId) ?? 0),
        0,
      );
      // Spread purchases over the last few hours so the sales-over-time chart
      // in T37 has a shape instead of a single spike.
      const boughtAt = new Date(Date.now() - Math.random() * 6 * HOUR);

      const [order] = await db
        .insert(orders)
        .values({
          userId: buyer.id,
          eventId: event.id,
          totalCents: total,
          status: "paid",
          stripeSessionId: `cs_test_seed_${randomUUID()}`,
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
            // About a third of an ended show's crowd has walked through the gate.
            checkedInAt:
              spec.status === "ended" && Math.random() < 0.35
                ? new Date(boughtAt.getTime() + 2 * DAY)
                : null,
          };
        }),
      );

      totalRevenue += total;
    }

    if (toSell.length > 0) {
      await db
        .update(seats)
        .set({ status: "sold" })
        .where(
          inArray(
            seats.id,
            toSell.map((s) => s.id),
          ),
        );
    }
    totalSold += toSell.length;

    console.log(
      `  ${spec.status.padEnd(9)} ${event.title.slice(0, 38).padEnd(40)} ` +
        `${createdSeats.length} seats, ${toSell.length} sold`,
    );
  }

  console.log(
    `\ndone: 1 venue, ${eventSpecs.length} events, ${totalSeats} seats, ` +
      `${totalSold} sold, Rs ${(totalRevenue / 100).toLocaleString("en-IN")} revenue\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
