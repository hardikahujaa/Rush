# Rush
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
