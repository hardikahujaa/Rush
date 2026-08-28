/**
 * Cross-page proof for T19.
 *
 * verify-seat-math.ts proves the DATA is internally consistent. This proves the
 * three RENDERED pages agree with it, which is a different claim: a page can
 * read the right function and still print the wrong number.
 *
 * For every mock event it fetches the landing page, the T18 detail page and the
 * T19 seat map, extracts the count each one actually shows, and asserts all
 * three are equal.
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
 * The landing card badge: read from the aria-label, because the visible digits
 * are split across elements by the flip animation and cannot be regexed.
 *
 * The card is sliced from its own href to the START OF THE NEXT CARD rather
 * than to the next `</a>`. A card containing a scarcity counter nests anchors
 * and spans deeply enough that a fixed lookahead window truncates mid-card,
 * which reads as "no card found" when the card is right there.
 */
function landingCount(html, id) {
  const start = html.indexOf(`href="/events/${id}"`);
  if (start === -1) return { kind: "missing" };
  const next = html.indexOf('href="/events/', start + 20);
  const card = html.slice(start, next === -1 ? start + 12000 : next);

  const only = /aria-label="Only (\d+) seats? left"/.exec(card);
  if (only) return { kind: "critical", count: Number(only[1]) };
  if (/Selling fast/.test(card)) return { kind: "warn" };
  return { kind: "quiet" };
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

console.log("event   landing         detail left  map left/total   selectable   verdict");
console.log("─".repeat(76));

for (const id of IDS) {
  const [home, detail, map] = await Promise.all([
    get("/"),
    get(`/events/${id}`),
    get(`/events/${id}/seats`),
  ]);

  const before = failures;
  const badge = landingCount(home, id);
  const d = detailCounts(detail);
  const m = mapCounts(map);
  const rendered = mapSeatStates(map);

  if (!m) {
    fail(id, "seat map did not render an availability header");
    continue;
  }

  // 1. detail page tiers sum to the map's whole-venue figure
  if (d.left !== m.left) fail(id, `detail sums to ${d.left}, map header says ${m.left}`);

  // 2. the badge, when it shows a number, is that same figure
  if (badge.kind === "critical" && badge.count !== m.left) {
    fail(id, `landing badge says ${badge.count}, map says ${m.left}`);
  }
  if (badge.kind === "missing") fail(id, "no card found on the landing page");

  // 3. the seats you can actually click equal the number advertised
  const clickable = rendered.available + rendered.standingAvailable;
  if (clickable !== m.left) {
    fail(id, `advertises ${m.left} available but renders ${clickable} selectable`);
  }

  const badgeText =
    badge.kind === "critical" ? `Only ${badge.count}` : badge.kind === "warn" ? "Selling fast" : "—";

  console.log(
    `${id.padEnd(7)} ${badgeText.padEnd(15)} ${String(d.left).padEnd(12)} ` +
      `${String(m.left + "/" + m.total).padEnd(16)} ${String(clickable).padEnd(12)} ` +
      (failures === before ? "agree" : "MISMATCH"),
  );
}

console.log("─".repeat(76));
console.log(
  failures === 0
    ? `PASS — ${IDS.length} events: landing badge, pricing table and seat map all agree`
    : `${failures} FAILURES`,
);
process.exit(failures === 0 ? 0 : 1);
