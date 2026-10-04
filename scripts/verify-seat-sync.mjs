/**
 * Cross-page proof for T19.
 *
 * verify-seat-math.ts proves the DATA is internally consistent. This proves the
 * three RENDERED pages agree with it, which is a different claim: a page can
 * read the right function and still print the wrong number.
 *
 * For every mock event it fetches the T18 detail page and the T19 seat map,
 * extracts the count each one actually shows, and asserts they agree.
 *
 * ── THE LANDING PAGE LEFT THIS COMPARISON IN T17 ──────────────────────────
 * It used to be a three-way check, with the homepage card's scarcity badge as
 * the third witness. T17 pointed the homepage at Postgres, so it no longer
 * renders mock events at all and that third of the assertion has no subject -
 * it would fail for the right reason, which is the worst kind of failing test.
 *
 * The remaining two pages still serve mock events through `event-lookup.ts`'s
 * fallback, so what this script actually proves is unchanged in kind: a page can
 * read the right function and still print the wrong number. Real events are
 * covered by the T17 click-path crawl instead, which asserts every homepage card
 * reaches a seat map that genuinely renders seats.
 *
 *   node scripts/verify-seat-sync.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? "http://localhost:3000";

const IDS = [
  "sf-1", "sf-2", "sf-3", "sf-4",
  "rc-1", "rc-2", "rc-3", "rc-4",
  "cm-1", "cm-2", "cm-3",
  "mv-1", "mv-2", "mv-3",
];

const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|\s+/g, " ");

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.text();
}

/**
 * The T18 pricing table: sum the per-tier "N of M seats available" rows.
 *
 * Only `left` is summable. A sold-out tier renders the words "Sold out" and
 * omits its capacity entirely, so the venue total genuinely is not present in
 * that page's markup - reporting a total here would mean reporting a number the
 * page never showed.
 */
function detailCounts(html) {
  const body = text(html);
  let left = 0;
  let rows = 0;
  for (const m of body.matchAll(/(\d+) of (\d+) seats available/g)) {
    left += Number(m[1]);
    rows++;
  }
  const soldOutRows = [...body.matchAll(/Sold out/g)].length;
  return { left, rows: rows + soldOutRows };
}

/** The T19 map header, which is the whole-venue figure. */
function mapCounts(html) {
  const m = /(\d+) of (\d+) seats available/.exec(text(html));
  return m ? { left: Number(m[1]), total: Number(m[2]) } : null;
}

/** Seats actually rendered as clickable buttons, by aria-label suffix. */
function mapSeatStates(html) {
  const labels = [...html.matchAll(/aria-label="([^"]*?, (?:available|sold|on hold, unavailable))"/g)];
  const state = { available: 0, sold: 0, held: 0 };
  for (const [, l] of labels) {
    if (l.endsWith(", sold")) state.sold++;
    else if (l.endsWith("on hold, unavailable")) state.held++;
    else state.available++;
  }
  const standing = /aria-label="[^"]*?, (\d+) available\. Add one admission\."/.exec(html);
  state.standingAvailable = standing ? Number(standing[1]) : 0;
  return state;
}

let failures = 0;
const fail = (id, msg) => {
  failures++;
  console.log(`  FAIL  ${id} — ${msg}`);
};

console.log("event   detail left  map left/total   selectable   verdict");
console.log("─".repeat(62));

for (const id of IDS) {
  const [detail, map] = await Promise.all([
    get(`/events/${id}`),
    get(`/events/${id}/seats`),
  ]);

  const before = failures;
  const d = detailCounts(detail);
  const m = mapCounts(map);
  const rendered = mapSeatStates(map);

  if (!m) {
    fail(id, "seat map did not render an availability header");
    continue;
  }

  // 1. detail page tiers sum to the map's whole-venue figure
  if (d.left !== m.left) fail(id, `detail sums to ${d.left}, map header says ${m.left}`);

  // 2. the seats you can actually click equal the number advertised
  const clickable = rendered.available + rendered.standingAvailable;
  if (clickable !== m.left) {
    fail(id, `advertises ${m.left} available but renders ${clickable} selectable`);
  }

  console.log(
    `${id.padEnd(7)} ${String(d.left).padEnd(12)} ` +
      `${String(m.left + "/" + m.total).padEnd(16)} ${String(clickable).padEnd(12)} ` +
      (failures === before ? "agree" : "MISMATCH"),
  );
}

console.log("─".repeat(62));
console.log(
  failures === 0
    ? `PASS — ${IDS.length} events: pricing table and seat map agree`
    : `${failures} FAILURES`,
);
process.exit(failures === 0 ? 0 : 1);
