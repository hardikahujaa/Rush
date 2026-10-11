/**
 * T35 verification — the pure half of the waiting-room UI.
 *
 *   npm run queue-ui-test          (no database, no Redis, no dev server)
 *
 * ── WHAT THIS CAN AND CANNOT PROVE ────────────────────────────────────────
 * T35 is a visual task, and most of it is only judgeable by looking at it. So
 * the logic that is NOT visual was deliberately extracted into two React-free
 * modules - `queue-display.ts` and `queue-messages.ts` - and that is what this
 * asserts. The point is not coverage for its own sake: the three properties
 * below are exactly the ones whose failure modes are invisible in a browser
 * until they are embarrassing.
 *
 *   1. THE HYDRATION CONTRACT. Every function returns its server-identical
 *      answer at `tick === 0`. If one of them read the real clock instead,
 *      React would log a mismatch in production and nobody would notice during
 *      development, because the server and client clocks agree on a dev
 *      machine.
 *   2. THE ROTATION INVARIANT. `queueMessages` must always return exactly
 *      `TICKER_SLOTS` entries, because the displayed index is derived as
 *      `floor(tick / ROTATE) % length`. A length that varies with state makes
 *      the ticker jump to an unrelated line mid-cycle - an intermittent glitch
 *      that is near-impossible to reproduce by hand.
 *   3. THE ETA DECAY CAP. An uncapped countdown is a liar: with polls failing
 *      it would march to "any moment now" while the user is four hundred back.
 *
 * Not covered here, and stated plainly rather than implied: the rendered
 * appearance, the spring timings, and the phase machine in
 * `use-queue-position.ts` - that module imports `next/navigation`, which cannot
 * be evaluated under `--conditions=react-server` (the same chain that forced
 * the `queue-api` / `queue-response` split in T34).
 */
import {
  ETA_DECAY_CAP_SECONDS,
  decayEta,
  formatEta,
  formatHeartbeat,
  progressOf,
} from "../src/components/queue/queue-display";
import {
  ROTATE_SECONDS,
  TICKER_SLOTS,
  queueMessages,
  tickerIndex,
} from "../src/components/queue/queue-messages";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

/* A poll that landed at second 100 of the epoch. Fixed, so nothing here reads
   the real clock either. */
const AT = 100_000;

function main() {
  /* ── 1. the hydration contract ──────────────────────────────────────────── */
  console.log("\n1. The hydration contract (tick === 0 means 'not hydrated')");

  eq("decayEta returns the server value undecayed", decayEta(120, AT, 0), 120);
  eq("tickerIndex is slot 0 for everybody", tickerIndex(0), 0);
  eq(
    "formatHeartbeat renders nothing rather than a bogus age",
    formatHeartbeat(AT, 0, false),
    null,
  );
  /* The one exception, and it is safe: an in-flight request is known from state
     rather than the clock, so it is identical on both sides of hydration. */
  eq(
    "...unless a request is in flight, which is state, not time",
    formatHeartbeat(AT, 0, true),
    "checking now…",
  );
  eq(
    "progressOf never touches the clock at all",
    progressOf(50, 100),
    0.5,
  );

  /* ── 2. the rotation invariant ──────────────────────────────────────────── */
  console.log("\n2. The rotation invariant (constant length, or the ticker jumps)");

  let constant = true;
  for (const online of [true, false]) {
    for (const inFlight of [true, false]) {
      for (const ahead of [0, 1, 2, 49, 1_000, 999_999]) {
        const n = queueMessages({ ahead, inFlight, online }).length;
        if (n !== TICKER_SLOTS) constant = false;
      }
    }
  }
  check(
    `always exactly ${TICKER_SLOTS} entries across 24 state combinations`,
    constant,
  );

  eq("tick 0 → slot 0", tickerIndex(0), 0);
  eq(`tick ${ROTATE_SECONDS - 1} → still slot 0`, tickerIndex(ROTATE_SECONDS - 1), 0);
  eq(`tick ${ROTATE_SECONDS} → slot 1`, tickerIndex(ROTATE_SECONDS), 1);
  eq(
    "the last slot is reached",
    tickerIndex(ROTATE_SECONDS * (TICKER_SLOTS - 1)),
    TICKER_SLOTS - 1,
  );
  eq(
    "and it wraps back to 0",
    tickerIndex(ROTATE_SECONDS * TICKER_SLOTS),
    0,
  );

  let inRange = true;
  for (let t = 1; t < 400; t++) {
    const i = tickerIndex(t);
    if (!Number.isInteger(i) || i < 0 || i >= TICKER_SLOTS) inRange = false;
  }
  check("the index is always a valid slot over 400 seconds", inRange);

  /* ── 3. every line is true ──────────────────────────────────────────────── */
  console.log("\n3. The live slot says what is actually happening");

  const idle = queueMessages({ ahead: 41, inFlight: false, online: true });
  const busy = queueMessages({ ahead: 41, inFlight: true, online: true });
  const down = queueMessages({ ahead: 41, inFlight: true, online: false });

  eq("idle → 'You are in line.'", idle[0], "You are in line.");
  eq("a real request in flight → 'Checking your place…'", busy[0], "Checking your place…");
  check(
    "a failed connection outranks in-flight (it is the more useful truth)",
    down[0].includes("Reconnecting"),
    down[0],
  );

  check(
    "the position slot carries the real number",
    idle[1].includes((41).toLocaleString("en-IN")),
    idle[1],
  );
  eq("ahead 0 → 'You are next in line.'", idle0()[1], "You are next in line.");
  check(
    "ahead 1 is singular, not '1 people ahead'",
    queueMessages({ ahead: 1, inFlight: false, online: true })[1].includes("1 person"),
  );

  /* No line may claim work that is not running. These two substrings are the
     brief's original copy, and their absence is the decision recorded in
     `queue-messages.ts`. */
  const everyLine = [...idle, ...busy, ...down].join(" | ");
  check(
    "no line claims to 'verify inventory' while nothing is being verified",
    !/verif\w* inventory/i.test(everyLine),
    everyLine,
  );
  check(
    "no line claims to be 'securing' anything between polls",
    !/securing/i.test(everyLine),
    everyLine,
  );

  /* ── 4. the ETA decay, and its cap ──────────────────────────────────────── */
  console.log("\n4. The wait estimate decays — but cannot run away");

  eq("null stays null (nothing measured yet)", decayEta(null, AT, 200), null);
  eq("no successful poll yet → undecayed", decayEta(120, 0, 200), 120);
  eq("5 seconds later → 5 seconds less", decayEta(120, AT, 105), 115);
  eq(
    `capped at ${ETA_DECAY_CAP_SECONDS}s of drift, however long polls stop for`,
    decayEta(120, AT, 100 + 600),
    120 - ETA_DECAY_CAP_SECONDS,
  );
  eq("never negative", decayEta(3, AT, 100 + 600), 0);
  eq(
    "a tick behind the poll (clock skew) does not ADD time",
    decayEta(120, AT, 90),
    120,
  );

  /* ── 5. formatting ─────────────────────────────────────────────────────── */
  console.log("\n5. Formatting is vague where the data is uncertain");

  eq("0 → any moment now", formatEta(0), "any moment now");
  eq("negative is impossible but handled", formatEta(-5), "any moment now");
  eq("30s", formatEta(30), "less than a minute");
  eq("45s is still the sub-minute bucket", formatEta(45), "less than a minute");
  eq("46s", formatEta(46), "about a minute");
  eq("100s", formatEta(100), "about 2 minutes");
  eq("59 min", formatEta(3_540), "about 59 minutes");
  eq("60 min", formatEta(3_600), "over an hour");
  eq("2 h", formatEta(7_200), "about 2 hours");
  check(
    "no bucket ever prints a false precision like 'about 27 minutes 14 seconds'",
    !/\d+\s*(seconds|sec)\b/i.test(
      [30, 46, 100, 3_540, 3_600, 7_200].map(formatEta).join(" "),
    ),
  );

  console.log("\n6. The heartbeat");
  eq("just polled", formatHeartbeat(AT, 100, false), "checked just now");
  eq("1s is still 'just now'", formatHeartbeat(AT, 101, false), "checked just now");
  eq("5s", formatHeartbeat(AT, 105, false), "checked 5s ago");
  eq("59s", formatHeartbeat(AT, 159, false), "checked 59s ago");
  eq("60s rolls to minutes", formatHeartbeat(AT, 160, false), "checked 1m ago");
  eq(
    "in flight always wins — it is the most current fact",
    formatHeartbeat(AT, 160, true),
    "checking now…",
  );

  /* ── 7. the progress bar cannot mislead ────────────────────────────────── */
  console.log("\n7. Progress is monotonic and bounded");

  eq("no baseline yet → 0", progressOf(41, 0), 0);
  eq("halfway", progressOf(50, 100), 0.5);
  eq("at the front → 1", progressOf(0, 100), 1);
  eq(
    "ahead somehow exceeding peak clamps to 0 rather than going negative",
    progressOf(150, 100),
    0,
  );

  /* The property that matters: as `ahead` falls, the bar only ever advances.
     This is why the denominator is the user's own starting position and not
     `waitingTotal`, which grows as people join behind them. */
  let monotonic = true;
  let previous = -1;
  for (let ahead = 500; ahead >= 0; ahead--) {
    const p = progressOf(ahead, 500);
    if (p < previous) monotonic = false;
    previous = p;
  }
  check("the bar never moves backwards over a 500-place journey", monotonic);

  let bounded = true;
  for (const [ahead, peak] of [
    [0, 1],
    [1, 1],
    [999, 1_000],
    [0, 0],
    [7, 3],
  ] as const) {
    const p = progressOf(ahead, peak);
    if (!(p >= 0 && p <= 1)) bounded = false;
  }
  check("and always lands inside [0, 1]", bounded);
}

/** ahead: 0, with everything else held steady. */
function idle0() {
  return queueMessages({ ahead: 0, inFlight: false, online: true });
}

try {
  main();
} catch (error) {
  failed++;
  console.error("\n  UNCAUGHT:", error);
}

console.log("\n" + "─".repeat(64));
console.log(failed === 0 ? `PASS — ${passed} checks` : `${failed} FAILED of ${passed + failed}`);
process.exitCode = failed === 0 ? 0 : 1;
