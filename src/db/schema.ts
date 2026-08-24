import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * RUSH database schema.
 *
 * Two conventions run through this whole file:
 *
 * 1. MONEY IS ALWAYS AN INTEGER. Every `*Cents` column is a whole number of the
 *    smallest currency unit (paise, since we bill in INR). Rs 4,999 is stored as
 *    499900. Floating point cannot represent 0.1 exactly, so summing floats
 *    drifts - and a ticketing ledger that drifts is one that loses money.
 *
 * 2. EVERY TIMESTAMP IS `timestamptz`. Postgres stores it as UTC and converts on
 *    the way out. A plain `timestamp` carries no zone, so "the drop is at 18:00"
 *    turns ambiguous the moment one server sits in a different region from
 *    another. For a product whose entire premise is *what time it is*, that is
 *    not a detail we can leave loose.
 */

/* -- enums --------------------------------------------------------------- */

export const userRole = pgEnum("user_role", ["buyer", "organizer", "staff"]);

export const eventStatus = pgEnum("event_status", [
  "draft",
  "scheduled",
  "live",
  "ended",
]);

export const seatStatus = pgEnum("seat_status", ["available", "held", "sold"]);

export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
]);

/* -- users --------------------------------------------------------------- */

/**
 * Mirrors Supabase's `auth.users`. The id is NOT generated here - we copy the
 * uuid Supabase Auth issues at signup, so the two tables stay in lockstep and we
 * can join our business data (role, orders) onto the authenticated user.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: userRole("role").notNull().default("buyer"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -- venues -------------------------------------------------------------- */

export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -- events -------------------------------------------------------------- */

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    posterUrl: text("poster_url"),
    /** When tickets become buyable - the moment everybody piles in. */
    dropAt: timestamp("drop_at", { withTimezone: true }).notNull(),
    /** When the show itself starts. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    status: eventStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The events listing filters on status and orders by drop time.
    index("events_status_drop_at").on(t.status, t.dropAt),
  ],
);

/* -- sections ------------------------------------------------------------ */

/**
 * Price lives HERE, not on the seat.
 *
 * A section ("Front", Rs 4,999) holds one price shared by every seat in it. If
 * we copied that price onto all ~96 seat rows instead, changing it would mean 96
 * writes that must all succeed or all fail - and any that silently did not would
 * leave two seats in the same row selling for different amounts, with no way to
 * tell which is correct. Storing a fact once and pointing at it is called
 * normalisation, and this is exactly what it is for.
 *
 * `orderItems` deliberately breaks this rule - see the note there.
 */
export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
  },
  (t) => [uniqueIndex("sections_event_name").on(t.eventId, t.name)],
);

/* -- seats --------------------------------------------------------------- */

/**
 * `status` is a cache, not the truth.
 *
 * The authoritative answer to "is this seat taken?" is: does a live unexpired
 * row exist in `holds`, or any row in `order_items`? We keep `status` alongside
 * because rendering a 288-seat map should not require joining two tables - but
 * any query that decides whether a seat can be *sold* must consult the source of
 * truth, not this column. That is what the lazy-expiry work in T22 is about.
 */
export const seats = pgTable(
  "seats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    rowLabel: text("row_label").notNull(),
    seatNo: integer("seat_no").notNull(),
    status: seatStatus("status").notNull().default("available"),
  },
  (t) => [
    /**
     * T10 constraint 3 of 3. The seat map query is `WHERE event_id = ? AND
     * status = ?` against the largest table in the database. Without this index
     * Postgres reads every seat row of every event to answer it.
     */
    index("seats_event_status").on(t.eventId, t.status),
    /**
     * A physical seat exists once. Row labels are scoped to their SECTION, not
     * to the event - real venues number "Row A, seat 1" separately in Front,
     * Middle and Rear, so section_id has to be part of the key or the second
     * section would collide with the first.
     */
    uniqueIndex("seats_unique_position").on(
      t.eventId,
      t.sectionId,
      t.rowLabel,
      t.seatNo,
    ),
  ],
);

/* -- holds --------------------------------------------------------------- */

/**
 * A temporary claim on one seat: "this is mine for the next 10 minutes while I
 * find my card." One row per seat, so a 4-seat selection creates 4 rows.
 *
 * `releasedAt` is nullable on purpose and rows are never deleted - a null value
 * means the hold is still live, and keeping released rows gives us the funnel
 * analytics in T36 (how many holds became purchases) for free.
 */
export const holds = pgTable(
  "holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * T10 constraint 1 of 3 - THE most important line in this schema.
     *
     * A PARTIAL unique index: unique only across rows where `released_at IS
     * NULL`. So a seat may carry a hundred released holds in its history, but
     * never two live ones at the same instant. If our application code has a
     * race condition, Postgres itself rejects the second insert. The guarantee
     * lives in the database, where a bug in TypeScript cannot reach it.
     */
    uniqueIndex("one_live_hold_per_seat")
      .on(t.seatId)
      .where(sql`released_at is null`),
    // "Which of my seats are still held?" - the countdown UI asks this.
    index("holds_user_expires").on(t.userId, t.expiresAt),
  ],
);

/* -- orders -------------------------------------------------------------- */

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    totalCents: integer("total_cents").notNull(),
    status: orderStatus("status").notNull().default("pending"),
    stripeSessionId: text("stripe_session_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("orders_user_created").on(t.userId, t.createdAt)],
);

/* -- order items --------------------------------------------------------- */

/**
 * `priceCents` is duplicated from `sections` here ON PURPOSE - the one place we
 * deliberately denormalise.
 *
 * This is a financial record. If the organizer raises the Front section from
 * Rs 4,999 to Rs 5,999 next week, a receipt that read its price through a join
 * would retroactively rewrite what the customer paid. Copying the price at
 * purchase time freezes history. Rule of thumb: point at live data, copy
 * historical facts.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "restrict" }),
    priceCents: integer("price_cents").notNull(),
  },
  (t) => [
    /**
     * T10 constraint 2 of 3. The final backstop against an oversell: a seat can
     * appear on exactly one order line, ever. Even if a hold somehow leaked and
     * two people reached Stripe, only one of their webhooks can commit. The
     * other transaction dies here on a unique violation and we refund it - a bad
     * day, but not two people arriving to find one seat.
     */
    uniqueIndex("one_sold_seat").on(t.seatId),
  ],
);

/* -- tickets ------------------------------------------------------------- */

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "restrict" }),
    /** HMAC-SHA256 of `{ticketId}.{orderId}.{seatId}` - see T30. */
    qrSignature: text("qr_signature").notNull(),
    /** Null until someone walks through the gate. Set exactly once - see T31. */
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("tickets_seat_unique").on(t.seatId)],
);

/* -- webhook events ------------------------------------------------------ */

/**
 * The idempotency ledger for Stripe (T28).
 *
 * Stripe retries a webhook until it receives a 2xx - so if our handler issues
 * tickets and then times out before replying, Stripe sends the identical event
 * again. Without this table we would issue a second set of tickets for a single
 * payment. The unique constraint on `stripe_event_id` turns "have I already
 * processed this?" into something the database answers atomically, rather than
 * something we try to reason about in application code.
 */
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -- relations ----------------------------------------------------------- */
/* These generate no SQL. They teach Drizzle's query API how the tables join, so
   we can write db.query.events.findMany({ with: { venue: true } }). */

export const usersRelations = relations(users, ({ many }) => ({
  events: many(events),
  holds: many(holds),
  orders: many(orders),
}));

export const venuesRelations = relations(venues, ({ many }) => ({
  events: many(events),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  venue: one(venues, { fields: [events.venueId], references: [venues.id] }),
  organizer: one(users, {
    fields: [events.organizerId],
    references: [users.id],
  }),
  sections: many(sections),
  seats: many(seats),
  orders: many(orders),
}));

export const sectionsRelations = relations(sections, ({ one, many }) => ({
  event: one(events, { fields: [sections.eventId], references: [events.id] }),
  seats: many(seats),
}));

export const seatsRelations = relations(seats, ({ one, many }) => ({
  event: one(events, { fields: [seats.eventId], references: [events.id] }),
  section: one(sections, {
    fields: [seats.sectionId],
    references: [sections.id],
  }),
  holds: many(holds),
  orderItems: many(orderItems),
}));

export const holdsRelations = relations(holds, ({ one }) => ({
  seat: one(seats, { fields: [holds.seatId], references: [seats.id] }),
  user: one(users, { fields: [holds.userId], references: [users.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  event: one(events, { fields: [orders.eventId], references: [events.id] }),
  items: many(orderItems),
  tickets: many(tickets),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  seat: one(seats, { fields: [orderItems.seatId], references: [seats.id] }),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
  order: one(orders, { fields: [tickets.orderId], references: [orders.id] }),
  seat: one(seats, { fields: [tickets.seatId], references: [seats.id] }),
}));

/* -- inferred types ------------------------------------------------------ */
/* Drizzle derives these from the table definitions above, so the schema is the
   single source of truth for both the database AND our TypeScript types. Change
   a column and every misuse of it becomes a compile error. */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Venue = typeof venues.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Seat = typeof seats.$inferSelect;
export type Hold = typeof holds.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
