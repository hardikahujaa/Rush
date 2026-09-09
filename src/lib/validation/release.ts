import { z } from "zod";

import { MAX_SEATS_PER_USER } from "@/lib/validation/holds";

/**
 * Body schema for POST /api/holds/release.
 *
 * The same shape as `createHoldSchema`, and deliberately the same cap: a user
 * can never hold more than four seats, so a request naming more than four is
 * either a bug or someone probing. There is no legitimate release of five.
 *
 * De-duplicated for the same reason as the hold schema - naming a seat twice is
 * one intent, not two, and the UPDATE would count it once regardless.
 */
export const releaseHoldSchema = z.object({
  seatIds: z
    .array(z.uuid("Each seat id must be a uuid"))
    .min(1, "Name at least one seat to release")
    .max(MAX_SEATS_PER_USER, `You can hold at most ${MAX_SEATS_PER_USER} seats`)
    .transform((ids) => [...new Set(ids)].sort()),
});

export type ReleaseHoldInput = z.infer<typeof releaseHoldSchema>;
