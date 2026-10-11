/**
 * Turning T34's payload into things a human can read.
 *
 * Deliberately pure and React-free: no hooks, no `Date.now()`, no `Math.random()`.
 * That is what makes every rule in here assertable by `npm run queue-ui-test`
 * without a browser, and it is also what keeps the lobby free of the two bugs
 * this kind of UI attracts - a render loop, and a hydration mismatch.
 *
 * ── THE RULE ABOUT `tick` ──────────────────────────────────────────────────
 * Every function that needs the current time takes it as an argument, sourced
 * from `useSecondTick()`. That hook returns **0 on the server**, and `0` means
 * "not hydrated yet" throughout this file - never the epoch. Each function
 * below returns its undecayed, server-identical answer for `tick === 0`, which
 * is precisely why the first client paint matches the server HTML.
 */

/** How far the wait estimate is allowed to drift before a poll refreshes it. */
export const ETA_DECAY_CAP_SECONDS = 15;

/**
 * Count a wait estimate down between polls.
 *
 * ── WHY DECAY AT ALL ──────────────────────────────────────────────────────
 * Polls are up to twelve seconds apart at the back of a long line. A static
 * "about 4 minutes" sitting there for twelve seconds is the single thing most
 * likely to make somebody decide the page has frozen and hit refresh - which is
 * the exact load the queue exists to prevent. Decaying it every second is
 * honest motion: the number is derived from a real measured rate, and time
 * really is passing.
 *
 * ── WHY IT IS CAPPED, WHICH IS THE PART THAT MATTERS ──────────────────────
 * An uncapped countdown is a liar. If polls stop arriving - offline, a frozen
 * tab, Upstash having a bad minute - the estimate would keep marching to zero
 * and then sit at "any moment now" while the user is still four hundred back.
 * So elapsed time is clamped: the estimate may drift by at most
 * `ETA_DECAY_CAP_SECONDS`, which is just past the longest poll interval T34
 * hands out. Past that it simply stops moving, and `ConnectionNotice` is the
 * thing that explains why.
 *
 * Reaching 0 is therefore only possible when the estimate was already smaller
 * than one poll interval - i.e. when the front of the line genuinely is moments
 * away.
 */
export function decayEta(
  etaSeconds: number | null,
  receivedAtMs: number,
  tick: number,
): number | null {
  if (etaSeconds === null) return null;
  /* Not hydrated, or no successful poll yet: hand back exactly what the server
     rendered. */
  if (tick === 0 || receivedAtMs === 0) return etaSeconds;

  const elapsed = Math.min(
    Math.max(0, tick - Math.floor(receivedAtMs / 1000)),
    ETA_DECAY_CAP_SECONDS,
  );
  return Math.max(0, etaSeconds - elapsed);
}

/**
 * Human wait times, deliberately vague at the top end.
 *
 * The estimate comes from how fast the line moved in the last minute, so it is
 * genuinely uncertain - printing "27 minutes" implies a precision that does not
 * exist and that the user will hold us to. Rounded buckets are honest about
 * what is actually known.
 */
export function formatEta(seconds: number): string {
  if (seconds <= 0) return "any moment now";
  if (seconds <= 45) return "less than a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes <= 1) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "over an hour" : `about ${hours} hours`;
}

/**
 * How far along the bar should sit, as 0..1.
 *
 * ── WHY THE DENOMINATOR IS YOUR OWN STARTING POSITION ─────────────────────
 * The brief says `(total - position) / total`, and `total` has two candidates.
 * `waitingTotal` is the wrong one: people keep joining BEHIND you, so the
 * denominator grows while your numerator does not, and the bar slides
 * backwards even though you are moving forwards. A progress bar that retreats
 * reads as the queue cheating you.
 *
 * `peak` - the furthest back this browser has ever seen itself - only ever
 * grows, so the ratio is monotonic by construction. It also answers the
 * question the user is actually asking, which is "how far have *I* come".
 */
export function progressOf(ahead: number, peak: number): number {
  if (peak <= 0) return 0;
  return Math.min(1, Math.max(0, (peak - ahead) / peak));
}

/**
 * "checking now…" / "checked 4s ago".
 *
 * The honest heartbeat. This is the line that does the work the brief wanted a
 * fake ticker for: it proves the page is alive by reporting something that is
 * literally true and visibly changing every second, so there is no need to
 * invent background activity.
 *
 * Returns null before hydration and before the first successful poll, so the
 * caller renders nothing rather than "checked 56 years ago".
 */
export function formatHeartbeat(
  receivedAtMs: number,
  tick: number,
  inFlight: boolean,
): string | null {
  if (inFlight) return "checking now…";
  if (tick === 0 || receivedAtMs === 0) return null;

  const ago = Math.max(0, tick - Math.floor(receivedAtMs / 1000));
  if (ago <= 1) return "checked just now";
  if (ago < 60) return `checked ${ago}s ago`;
  const minutes = Math.floor(ago / 60);
  return `checked ${minutes}m ago`;
}
