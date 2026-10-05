import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * The database client.
 *
 * Two settings here are not optional, and both exist because we connect through
 * Supabase's TRANSACTION POOLER (port 6543) rather than straight to Postgres:
 *
 * `prepare: false`
 *   A prepared statement is Postgres caching a query plan under a name, so
 *   sending it again is cheap. That name lives on one backend connection. The
 *   transaction pooler hands your next query to whichever connection is free, so
 *   the name is very likely missing there and you get a confusing "prepared
 *   statement s1 does not exist". Turning them off is the price of pooling.
 *
 * `max: 1` in serverless
 *   Each Vercel function instance is its own tiny process. Ten instances holding
 *   ten connections each is a hundred connections to a database that allows far
 *   fewer. One connection per instance, returned to the pooler immediately, is
 *   what scales.
 *
 * `DB_POOL_MAX`
 *   An escape hatch for the concurrency tests, and nothing else. The defaults
 *   above are right for serving requests but wrong for PROVING the seat lock:
 *   fire fifty simultaneous hold attempts at a pool of five and forty-five of
 *   them never reach the database until the winner has already committed. They
 *   would come back "seat taken" by simply reading a taken seat, so the run
 *   looks like a passing race test while barely touching the lock.
 *   `scripts/race-test.ts` sets this to 50 so all fifty transactions are open at
 *   once. Unset - which is every other code path - changes nothing.
 *
 * The `globalThis` caching below is a development-only concern: Next.js hot
 * reload re-evaluates this module on every save, and without the cache each save
 * would open a fresh pool and leak the previous one until you exhausted the
 * database.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const poolMax =
  Number(process.env.DB_POOL_MAX) ||
  (process.env.NODE_ENV === "production" ? 1 : 5);

const conn =
  globalForDb.conn ??
  postgres(connectionString, {
    prepare: false,
    max: poolMax,
  });

if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });

export type Db = typeof db;
export { schema };

/**
 * Close the connection pool.
 *
 * For SCRIPTS only. A long-lived server never wants this - the pool is meant to
 * outlive individual requests - but a one-shot script that calls
 * `process.exit()` with sockets still open makes libuv assert on Windows
 * (`!(handle->flags & UV_HANDLE_CLOSING)`), which looks like a crash at the end
 * of a run that succeeded.
 */
export async function closeDb(): Promise<void> {
  await conn.end({ timeout: 5 });
}
