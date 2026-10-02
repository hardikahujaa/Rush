import { z } from "zod";

import { MAX_SEATS_PER_USER } from "@/lib/validation/holds";

/**
 * The metadata WE attached to the Checkout Session in T27, read back.
 *
 * ── WHY A SIGNATURE-VERIFIED PAYLOAD STILL GETS VALIDATED ──────────────────
 * CLAUDE.md's rule is "validate every API input with Zod, no exceptions", and
 * this is an input even though the signature already proved Stripe sent it.
 * The signature answers "did this come from Stripe?" - it says nothing about
 * whether the SHAPE is what this handler expects. The values here were written
 * by our own code in `src/lib/checkout-session.ts`, so a malformed one means a
 * bug on our side, or a session created by an older version of that code, or a
 * session created by hand in the Stripe dashboard. All three are real, and all
 * three must fail loudly rather than reach the database as `undefined`.
 *
 * Stripe's metadata values are ALWAYS strings - that is a property of their
 * API, not a choice here - so `seatIds` arrives as the comma-joined string
 * `checkout-session.ts` built and is split back apart. The cap is the same
 * `MAX_SEATS_PER_USER` the hold and checkout schemas enforce: a session naming
 * more seats than a user may ever hold did not come from this application's
 * normal path.
 */
export const checkoutMetadataSchema = z.object({
  orderId: z.uuid("metadata.orderId must be a uuid"),
  seatIds: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .pipe(
      z
        .array(z.uuid("Each seat id in metadata must be a uuid"))
        .min(1, "metadata.seatIds named no seats")
        .max(MAX_SEATS_PER_USER, `metadata.seatIds named more than ${MAX_SEATS_PER_USER} seats`),
    ),
});

export type CheckoutMetadata = z.infer<typeof checkoutMetadataSchema>;
