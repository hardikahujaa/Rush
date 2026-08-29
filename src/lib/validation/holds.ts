import { z } from "zod";

/** The purchase limit. One number, imported by both the schema and the transaction. */
export const MAX_SEATS_PER_USER = 4;

/**
 * Body schema for POST /api/holds.
 *
 * `z.uuid()` rather than `z.string().uuid()` - Zod 4 promoted the format
 * validators to top level, matching the note in `validation/auth.ts`.
 *
 * ── WHY THE IDS ARE DE-DUPLICATED HERE ─────────────────────────────────────
 * A client that sends the same seat twice is asking for two holds on one seat.
 * The partial unique index would reject the second row, so the request would
 * fail with "someone already holds this seat" - and the someone would be
 * themselves, one array element earlier. De-duplicating turns a confusing 409
 * into a request that simply does the obvious thing.
 *
 * The sort is NOT what makes locking deadlock-safe; the `ORDER BY` in the SQL is
 * (see the note in db/queries/holds.ts). It is here so the id list has one
 * canonical form, which keeps logs comparable across retries.
 */
export const createHoldSchema = z.object({
  seatIds: z
    .array(z.uuid("Each seat id must be a uuid"))
    .min(1, "Select at least one seat")
    /* Checked before de-duplication, so sending the same seat five times is
       rejected as over-limit rather than silently collapsing to one. */
    .max(MAX_SEATS_PER_USER, `You can hold at most ${MAX_SEATS_PER_USER} seats`)
    .transform((ids) => [...new Set(ids)].sort()),
});

export type CreateHoldInput = z.infer<typeof createHoldSchema>;
