import { z } from "zod";

import { MAX_SEATS_PER_USER } from "@/lib/validation/holds";

/**
 * Body schema for POST /api/checkout.
 *
 * Identical shape to `releaseHoldSchema` and `createHoldSchema`, and the same
 * cap for the same reason - a user can never legitimately hold more than four
 * seats, so naming more than four here is either a stale client or a probe,
 * not a real checkout.
 *
 * De-duplicated and sorted for the same reason as the other two schemas: one
 * seat named twice is one intent, and a canonical id list keeps logs
 * comparable across retries.
 */
export const checkoutSchema = z.object({
  seatIds: z
    .array(z.uuid("Each seat id must be a uuid"))
    .min(1, "Select at least one seat")
    .max(MAX_SEATS_PER_USER, `You can check out at most ${MAX_SEATS_PER_USER} seats`)
    .transform((ids) => [...new Set(ids)].sort()),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
