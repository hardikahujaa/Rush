import { z } from "zod";

import { PAYLOAD_CHARS } from "@/lib/ticket-crypto";

/**
 * Body schema for POST /api/scan.
 *
 * ── WHY THE LENGTH IS BOUNDED HERE ─────────────────────────────────────────
 * A payload is exactly 44 characters (`PAYLOAD_CHARS`). `decodeTicketPayload`
 * would reject anything else on its own, but it is handed the string only after
 * this passes - so capping the length first means a megabyte of pasted garbage
 * is refused by a length check rather than by a regex run over a megabyte.
 *
 * A little headroom above the exact length, rather than `.length(44)`, so a
 * future payload version can grow without this schema becoming the thing that
 * blocks it. The codec's own strict check is what enforces the exact shape.
 *
 * ── WHY THE PAYLOAD IS IN THE BODY, NOT THE URL ────────────────────────────
 * A ticket payload is a bearer credential. In a query string it would be
 * written to access logs, proxy logs and browser history - the project's
 * standing rule against putting sensitive data in URLs applies to it exactly.
 */
export const scanSchema = z.object({
  payload: z
    .string()
    .trim()
    .min(1, "Scan something first")
    .max(PAYLOAD_CHARS + 20, "That is not a ticket code"),
});

export type ScanInput = z.infer<typeof scanSchema>;
