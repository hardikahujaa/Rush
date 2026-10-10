import { z } from "zod";

/**
 * Body schema for the queue endpoints.
 *
 * ── WHY THE EVENT ID IS IN THE BODY AND VALIDATED AT ALL ───────────────────
 * It is the only thing the client gets to choose, and it is the thing an
 * attacker would reach for first: joining a quiet event's queue to be admitted
 * instantly, then presenting that admission at the busy event's gate.
 *
 * Validating the shape here does not stop that - `verifyAdmission` does, by
 * binding the event id inside the signature. What this stops is the cheaper
 * attack underneath it: an id of `*`, a 4KB string, or `../../`, reaching a
 * Redis key template. `rush:queue:${eventId}:waiting` built from an unvalidated
 * string is a key-injection primitive, and `z.uuid()` is what makes it inert.
 *
 * `z.uuid()` rather than `z.string().uuid()` - Zod 4 promoted the format
 * validators to the top level, as noted in `validation/holds.ts`.
 */
export const queueEventSchema = z.object({
  eventId: z.uuid("eventId must be a uuid"),
});

export type QueueEventInput = z.infer<typeof queueEventSchema>;
