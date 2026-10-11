/**
 * The rotating ticker copy.
 *
 * ── EVERY LINE IN HERE IS TRUE, AND THAT WAS A DECISION ───────────────────
 * The brief for this task asked for messages that "create the illusion of
 * constant background activity" - `Securing connection…`, `Verifying
 * inventory…` - cycling on a timer while, between polls, the server is doing
 * nothing at all.
 *
 * This project has already settled that question once, in the opposite
 * direction. `components/home/seat-counter.tsx` used to decrement its own
 * number on a random timer, and it was deleted with the reasoning written into
 * the file: a number that moves regardless of whether anyone is buying is
 * manufactured pressure, "precisely the dark pattern the honest no-oversell
 * backend exists to avoid". A status line claiming to verify inventory when no
 * request is in flight is the same move in text form.
 *
 * It is also unnecessary, which is the useful part. The liveness comes from
 * motion that is genuinely driven by real state - the per-second ETA decay, the
 * "checked 3s ago" heartbeat, the bar settling on each new position, the
 * travelling `.live-pulse` sliver. Given those, the copy does not need to lie,
 * and a waiting room whose every claim survives scrutiny is more reassuring
 * than one whose claims do not.
 *
 * ── WHY THE ARRAY LENGTH IS CONSTANT ─────────────────────────────────────
 * The displayed index is derived, not stored: `floor(tick / ROTATE) % length`.
 * If `length` changed as state changed, the modulo would change with it and the
 * ticker would visibly jump to an unrelated message mid-cycle. So this always
 * returns exactly `TICKER_SLOTS` entries; only their CONTENT varies. Slot 0 is
 * the live one, and whatever it says is true at the moment it is on screen.
 */

/** Seconds each message holds the stage. */
export const ROTATE_SECONDS = 4;

/** Fixed, for the reason in the header. Changing it is a design change. */
export const TICKER_SLOTS = 5;

export type TickerInput = {
  /** People strictly ahead. 0 means next. */
  ahead: number;
  /** A request is genuinely open right now. */
  inFlight: boolean;
  /** The last request succeeded. */
  online: boolean;
};

/**
 * The five lines, in rotation order.
 *
 * Slot 0 - live status, derived from the request actually in flight.
 * Slot 1 - the user's real position.
 * Slots 2-4 - guidance and facts that are true at all times. None is phrased as
 *             a system action, so none can be false between polls.
 */
export function queueMessages({ ahead, inFlight, online }: TickerInput): string[] {
  const status = !online
    ? "Reconnecting to the queue…"
    : inFlight
      ? "Checking your place…"
      : "You are in line.";

  const position =
    ahead === 0
      ? "You are next in line."
      : ahead === 1
        ? "Your place is held · 1 person ahead"
        : `Your place is held · ${ahead.toLocaleString("en-IN")} ahead`;

  const lines = [
    status,
    position,
    /* True: the score in T34's sorted set is a Redis INCR sequence, so the
       order is exact rather than approximately right. */
    "Everyone is admitted in the order they arrived.",
    /* True: T22's lazy expiry. A hold that runs out frees its seat at the next
       read, with no cron involved. */
    "Seats return when someone's checkout expires.",
    /* The brief's own example, and honest - refreshing really does nothing,
       because the place is held against the account, not the tab. */
    "Keep this tab open. Refreshing will not move you up.",
  ];

  /* A compile-time-ish guarantee of the invariant the rotation depends on. If
     someone adds a sixth line, this fails loudly in development instead of
     producing an intermittent visual glitch nobody can reproduce. */
  if (lines.length !== TICKER_SLOTS) {
    throw new Error(
      `queueMessages must return exactly ${TICKER_SLOTS} entries; got ${lines.length}. ` +
        "The rotation index is derived from the length, so a varying length makes " +
        "the ticker jump mid-cycle.",
    );
  }

  return lines;
}

/**
 * Which slot is on screen.
 *
 * ── NO TIMER, NO STATE, AND THAT IS THE POINT ─────────────────────────────
 * The obvious implementation is `useState` + `setInterval` inside an effect,
 * which is exactly the shape React 19's `set-state-in-effect` rule refuses -
 * it has fired five times in this project already. Deriving the index from the
 * one shared clock means the ticker owns no timer, no state and no cleanup, and
 * cannot drift out of step with the ETA beside it, because both read the same
 * tick.
 *
 * At `tick === 0` - server render, and the first client paint before hydration -
 * this is 0 for everybody. That identity is the hydration guarantee.
 */
export function tickerIndex(tick: number, slots = TICKER_SLOTS): number {
  if (tick === 0) return 0;
  return Math.floor(tick / ROTATE_SECONDS) % slots;
}
