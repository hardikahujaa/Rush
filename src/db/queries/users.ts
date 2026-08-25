import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users, type User } from "@/db/schema";

/**
 * Look up an application user by their auth id.
 *
 * Returns null rather than throwing when the row is missing. That is a real
 * state, not an error: a Supabase auth account exists whose mirror row has not
 * been created. The database trigger in migration 0002 makes this very unlikely,
 * but "very unlikely" is not "impossible", and an authorization helper that
 * throws on an edge case fails open in whatever try/catch happens to be nearest.
 */
export async function findUserById(id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}
