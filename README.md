# Rush
![CI](https://github.com/hardikahujaa/Rush/actions/workflows/ci.yml/badge.svg)

High-demand ticket drop platform.

## Query performance (T38)

Three queries, all in `src/db/queries/analytics.ts`, measured with real `EXPLAIN (ANALYZE, BUFFERS)` output against a dev database padded to a realistic scale — `holds` to 300,000 rows, `orders` to 150,000 — using `npm run query-perf`. Full transcript and methodology in `scripts/query-perf.ts`.

| query | before | after | speedup |
|---|---|---|---|
| Q1 — revenue / sales-over-time (`orders` by event) | 5.9 ms | 0.4 ms | 15.8× |
| Q2 — funnel denominator (`holds` → `seats` by event) | 65.6 ms | 22.3 ms | 2.9× |
| Q3 — hold↔sale correlation (funnel numerator + avg. hold-to-purchase time) | 1156.6 ms | 1.7 ms | **693×** |

Two indexes fixed all three (added in migration `0006_eminent_dreadnoughts.sql`):

```sql
CREATE INDEX "orders_event_status" ON "orders" USING btree ("event_id","status");
CREATE INDEX "holds_seat_user_created" ON "holds" USING btree ("seat_id","user_id","created_at");
```

**Why only two tables.** `seats`, `sections`, `order_items` and `tickets` are all capped by the venue's seat count — `order_items` can never exceed 3,168 rows across every event this app sells, ever, because the `one_sold_seat` constraint permits exactly one row per seat. `holds` and `orders` have no such ceiling: every abandoned cart leaves a `holds` row forever, and every failed or abandoned checkout leaves an `orders` row in `'pending'`/`'failed'` that nothing deletes. Those are the two tables whose query plans degrade as the app ages, and T36's analytics queries hit both of them with no supporting index.

**Why one composite index per table, not three narrow ones.** `holds_seat_user_created`'s leading column (`seat_id`) alone already serves Q2's plain join; the full three-column order serves Q3. A separate `holds(seat_id)` index would duplicate that leading column for no query this app runs, while still costing `createHold` extra work on every insert — every index is write-time weight, not just a read-time asset.

### How to read an `EXPLAIN (ANALYZE, BUFFERS)` plan

Read it **inside-out**: the innermost (most indented) nodes run first; their output feeds the node above.

- **`Seq Scan on <table>`** — every row in the table is read, then filtered. Fine on a small table, expensive on one with no ceiling. This is the single thing to search for first.
- **`Index Scan` / `Index Only Scan` / `Bitmap Index Scan`** — the planner used an index to jump straight to matching rows instead of reading everything. `Index Only Scan` is the cheapest variant: it never touches the table's heap at all if every column it needs is in the index.
- **`rows=N` (estimate) vs `actual time=… rows=M`** — the planner's *guess* next to what actually happened. A wildly wrong estimate (stale statistics) can make the planner pick a bad join strategy even when a good index exists; `ANALYZE <table>` refreshes the estimate.
- **`loops=N`** — how many times this node executed, typically because it's the inner side of a nested loop. `actual time` here is *per loop*; multiply by `loops` for the total cost that node contributed. This is exactly what made Q3 expensive: an `Index Scan` that looked cheap per-loop (`cost=0.42..472.78`) ran 288 times and removed ~2 million rows via a join filter it couldn't push into the index — nothing here was a sequential scan, the index just didn't match the join condition tightly enough.
- **`Buffers: shared hit=X read=Y`** — `hit` is a page found already in Postgres's cache (cheap, in memory); `read` came from disk (or the OS cache). A plan with large `read` numbers on a hot path is a candidate for more RAM or a smaller working set, not necessarily a missing index.
- **`Planning Time` vs `Execution Time`** — printed separately on purpose. A query that plans slowly but executes fast is a different problem (e.g. too many indexes to consider) than one that plans fast and executes slowly (a missing index, almost always).
- **Total cost is read top node down; wall-clock time is read leaf node up.** The number next to the very first line (`cost=...`) is the planner's estimate for the *entire* query; `Execution Time` at the very bottom is what the database actually measured end to end.

## Load test (T42)

`k6 run loadtest/holds.js` — 500 real, independently-authenticated Supabase sessions, each attempting to hold one random seat from a dedicated 100-seat event, arrivals jittered across a ~25s window. `scripts/seed-load-test.ts` provisions the fixtures; `scripts/verify-load-test.ts` runs the actual correctness proof against Postgres immediately after.

**The headline numbers:**

| | |
|---|---|
| Requests | 500 |
| Oversells | **0** |
| Success / conflict split | 98 success / 402 conflict / 0 rate-limited / 0 unexpected |
| p95 latency | **2,426 ms** (tuned — `DB_POOL_MAX=20`) · 33,299 ms (default dev pool, `max: 5`) |

**With 500 people and 100 seats, at least 400 losing the race is the correct outcome, not a failure.** A run where everyone got `200` would mean the seat pool was bigger than intended — it would prove nothing. What actually matters: zero oversells, confirmed by querying Postgres directly, not by trusting the HTTP responses.

```
1. No seat has more than one live hold        → PASS (0 of 100 duplicated)
2. No seat appears on more than one paid order → PASS (0 order_items — this run only holds)
3. live holds never exceed the pool size       → PASS (98 / 100)
```

**The 14× latency gap between the two p95 numbers is the connection pool, found by measuring rather than assumed.** `src/db/index.ts` caps Postgres connections at `max: 5` in local dev (production defaults to `max: 1`, relying on Supabase's own pooler for fan-out). 500 concurrent requests sharing 5 connections queue behind each other — the first run's 33.3s p95 is that queue, not the row lock: correctness held identically at both pool sizes (0 oversells, same success/conflict split within noise), and `http_req_duration` measures time-to-response, which includes however long a request waited for a free connection before a transaction even began. Bumping `DB_POOL_MAX` to 20 and restarting the server dropped p95 to 2.4s with no other change — the lock was never the bottleneck; the pool was.

**One real bug the first run caught, in the test itself, not the app.** k6's `http_req_failed` metric treats any non-2xx response as a failure by default — it has no way to know a `409` here means the database correctly refused a seat that was already gone. With 400 of 500 responses *guaranteed* to be `409`, the first run tripped a `rate<0.01` threshold meant for genuine 5xx/timeout errors, on every run, regardless of correctness. Fixed with `http.setResponseCallback(http.expectedStatuses(200, 409, 429))` — after that, the threshold measures what it's supposed to.

**Windows setup** (verified on this install, not from memory — `winget`'s k6 package ID has changed since older guides were written):

```powershell
winget install -e --id GrafanaLabs.k6
k6 version
```

Run against localhost with the app's dev server up:

```
npm run seed-load-test -- 500    # once - provisions 500 real Supabase accounts
npm run loadtest                 # k6 run loadtest/holds.js
npm run verify-load-test         # the actual oversell proof
npm run reset-load-test          # release holds, ready for another run
```

Against a Vercel deployment: `BASE_URL=https://your-app.vercel.app k6 run loadtest/holds.js` — not run here, since this project has not yet been deployed (T05).

## Testing (T43)

```
npm run test              # Vitest unit tests — fast, no network
npm run test:integration  # Vitest against the real dev Supabase DB
npm run test:e2e          # Playwright — one full buyer path, real browser
```

**Unit vs. integration was a deliberate split, not a default.** `src/lib/qr.ts` and `src/lib/ticket-crypto.ts` are pure functions and get real unit tests (`tests/unit/`). "Hold expiry," though, is a database invariant — *"a hold is live iff `released_at IS NULL AND expires_at > now()`"* — compared against **Postgres's own clock**, not the app server's. Reimplementing that comparison in JavaScript and testing the reimplementation would prove nothing about the actual SQL in `src/db/queries/availability.ts`. `tests/integration/hold-expiry.test.ts` instead owns a small, disposable fixture and exercises the real exported SQL fragments and `releaseExpiredHolds()` directly against the dev DB — the same database every `scripts/*.ts` test already uses, just with real `expect()` assertions.

**A real gotcha, not a hypothetical one: `server-only` throws under Vitest by default.** Every query module starts with `import "server-only"`, whose export map resolves to an unconditionally-throwing `index.js` unless resolved under the `react-server` condition — which is exactly why every `tsx` script in `package.json` runs with `--conditions=react-server`. Vitest externalizes `node_modules` packages by default, which bypasses Vite's own `resolve.conditions` for them, so the fix in `vitest.config.mts` is an alias straight to an empty stub (`tests/stubs/server-only.ts`), not a conditions setting.

**Price calculation got a small, real refactor, not just a test.** `createHold` and `createPendingOrder` (and `getActiveHoldsForUser`) each had their own identical `.reduce((sum, item) => sum + item.priceCents, 0)`. Pulled into one `calculateTotalCents()` in `src/lib/pricing.ts` — deduplication the test needed in order to test anything at all, not a speculative abstraction. The full existing regression suite (`hold-test` 20 / `expiry-test` 18 / `release-test` 18 / `checkout-test` 24 / `webhook-test` 50 — 130 checks) was re-run after the change and stayed green.

**The one E2E test is real end-to-end, nothing mocked:** sign up → browse (`/events?q=`) → select a seat → hold → Stripe Checkout with the `4242 4242 4242 4242` test card → the success page, confirmed paid by the actual webhook. Two things have to already be running locally, stated plainly rather than silently assumed:

1. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` in a separate terminal. The success page polls for `"paid"`, and the order only flips once the webhook actually lands — without the tunnel the test hangs on the success page rather than failing fast.
2. The dev server (`npm run dev`), which `playwright.config.ts`'s `webServer` will start for you if it isn't already up.

Three real bugs surfaced building this, all found by running it against the real app rather than guessing selectors:

- `/available/i` as a seat-button matcher also matches `"...on hold, **un**available"` — anchored to `/, available$/i` instead, matching the exact suffix `SeatButton`'s label always ends with in the genuinely-free case.
- `SuccessView`'s confirmed heading (`"You're going."`) is `aria-hidden="true"` on purpose — the paid state is announced to assistive tech once, through a sibling `role="status"` live region, instead of twice. `getByRole("heading", ...)` can never find it; the test asserts on the status region's text instead.
- Playwright runs `globalSetup` and `globalTeardown` in the **same Node process**. Closing the (dev-mode, `globalThis`-cached) shared DB connection in setup handed teardown an already-ended connection. Fixed by giving the E2E fixtures their own connection, opened and closed within each call, independent of `src/db`'s app-singleton.

**Not chased further, and stated plainly:** a passing E2E run ends with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` on this Windows machine — after Playwright has already printed `1 passed`. Confirmed NOT caused by this project's code: it persists with the DB connection fully isolated and closed, and does not occur on a trivial spec using the identical config, so it tracks with this specific test's longer, cross-origin (`checkout.stripe.com`) navigation, not anything `purchase-flow.spec.ts` or its fixtures do. Reads as an upstream Node/Playwright-on-Windows native teardown quirk; the test result itself is unaffected.
