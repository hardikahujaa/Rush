import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL, { max: 1, prepare: false });

const q = async (label, query) => {
  const [r] = await query;
  console.log("  " + label.padEnd(46) + Object.values(r)[0]);
  return Object.values(r)[0];
};

console.log("\nCOUNTS");
await q("venues", sql`select count(*)::int from venues`);
await q("events", sql`select count(*)::int from events`);
await q("sections", sql`select count(*)::int from sections`);
await q("seats", sql`select count(*)::int from seats`);
await q("seats per event", sql`select (count(*)/3)::int from seats`);
await q("orders", sql`select count(*)::int from orders`);
await q("order_items", sql`select count(*)::int from order_items`);
await q("tickets", sql`select count(*)::int from tickets`);

console.log("\nINTEGRITY (every number below must be 0)");
const bad1 = await q("seats marked sold with NO order_item",
  sql`select count(*)::int from seats s where s.status='sold'
      and not exists (select 1 from order_items oi where oi.seat_id = s.id)`);
const bad2 = await q("order_items whose seat is NOT marked sold",
  sql`select count(*)::int from order_items oi join seats s on s.id=oi.seat_id
      where s.status <> 'sold'`);
const bad3 = await q("seats sold more than once (OVERSELLS)",
  sql`select coalesce(count(*),0)::int from (
        select seat_id from order_items group by seat_id having count(*) > 1) x`);
const bad4 = await q("orders whose total <> sum of its items",
  sql`select count(*)::int from (
        select o.id from orders o join order_items oi on oi.order_id=o.id
        group by o.id, o.total_cents having sum(oi.price_cents) <> o.total_cents) x`);
const bad5 = await q("tickets without a matching order_item",
  sql`select count(*)::int from tickets t where not exists (
        select 1 from order_items oi where oi.order_id=t.order_id and oi.seat_id=t.seat_id)`);

console.log("\nEVENTS");
const evs = await sql`
  select e.status, e.title,
         count(*) filter (where s.status='sold')::int as sold,
         count(*)::int as total,
         to_char(e.drop_at, 'YYYY-MM-DD HH24:MI') as drop_at
  from events e join seats s on s.event_id=e.id
  group by e.id, e.status, e.title, e.drop_at order by e.drop_at`;
for (const e of evs) console.log(`  ${e.status.padEnd(10)} ${String(e.sold).padStart(3)}/${e.total}  drop ${e.drop_at}  ${e.title.slice(0,34)}`);

await sql.end();
const bad = bad1+bad2+bad3+bad4+bad5;
console.log(bad === 0 ? "\nSeed data is fully consistent.\n" : `\n${bad} INTEGRITY PROBLEM(S).\n`);
process.exit(bad === 0 ? 0 : 1);
