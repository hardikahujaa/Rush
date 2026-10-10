import { NextResponse } from "next/server";

import { pollQueue } from "@/lib/queue";
import { prepareQueueRequest } from "@/lib/queue-api";
import { queueRunning, respondToPosition } from "@/lib/queue-response";

/**
 * GET /api/queue/position?eventId=<uuid> - how far up the line am I?
 *
 * The endpoint the lobby polls. It does three things in one atomic Redis
 * script: reports the position, heartbeats so the spot is not swept as
 * abandoned, and admits the user the moment their turn comes.
 *
 * ── ADMITTING FROM THE POLL IS THE DESIGN, NOT A SHORTCUT ──────────────────
 * PLAN.md sketches a separate `/api/queue/admit` that "pops the first N users",
 * which raises a question it does not answer: who calls it? On Vercel there is
 * no long-running process to run a drain loop, and a cron on a one-minute floor
 * would make every admission up to sixty seconds late - turning a live queue
 * into a slideshow. Worse, if the drain is the only thing that admits, a
 * failed cron run stops the queue dead while every client politely keeps
 * polling.
 *
 * Admitting from the poll inverts that: the people waiting ARE the drain loop.
 * The line advances exactly as fast as someone is there to care, there is no
 * scheduled job to fail, and capacity is still absolute because the check and
 * the insert happen inside one Lua script. Same instinct as T22's lazy expiry -
 * the read does the work, so no cron has to.
 *
 * ── WHY THIS IS A GET THAT WRITES ──────────────────────────────────────────
 * Normally a mutation should not be a GET. The two writes here are a heartbeat,
 * which is idempotent in effect, and an admission the caller is already
 * entitled to by their position - so a repeated or prefetched call cannot
 * produce anything the next poll would not have produced a second later. Making
 * it a POST would buy nothing and make the client's polling loop clumsier.
 *
 * ── ON CACHING ─────────────────────────────────────────────────────────────
 * This reads Supabase session cookies and can set an admission cookie, so it
 * must NEVER be cached - no `s-maxage`, no `revalidate`. A cached response
 * carrying a `Set-Cookie` would serve one person's session or pass to the next
 * visitor. Route handlers are dynamic by default; the rule is not to opt out.
 */
export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get("eventId");

  /* Wrapped into the same object shape the POST bodies use, so one Zod schema
     validates both and there is only one place the id can get through
     unchecked. */
  const prepared = await prepareQueueRequest(request, { eventId });
  if (!prepared.ok) return prepared.response;

  const { ctx } = prepared;

  /* The window closed while this user was waiting - the drop is over and the
     seat map is ungated again. Nobody should be left in a lobby for a queue
     that no longer exists. */
  if (!queueRunning(ctx.event)) {
    return NextResponse.json({ state: "open" });
  }

  return respondToPosition(await pollQueue(ctx.event.id, ctx.userId), ctx);
}
