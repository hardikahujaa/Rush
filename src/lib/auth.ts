import "server-only";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { cache } from "react";

import { findUserById } from "@/db/queries/users";
import { getVerifiedClaims } from "@/lib/supabase/server";
import type { User } from "@/db/schema";

export type Role = User["role"];

/**
 * AUTHORITATIVE identity for server code.
 *
 * Two steps, and both matter:
 *
 *  1. `getVerifiedClaims()` proves WHO the caller is. It verifies the JWT
 *     signature against the project's signing keys, so the id cannot be forged.
 *     (`getSession()` would skip that check and is never acceptable here.)
 *  2. The role is then read from OUR users table, not from the token.
 *
 * Step 2 is the whole point. src/proxy.ts reads the role out of the token
 * because it must be fast, but a token is a snapshot: revoke someone's organizer
 * role and their existing token still claims it for up to an hour. This function
 * asks the database, so it is always current. The proxy is the optimistic gate;
 * this is the real one.
 *
 * `cache()` memoises per REQUEST, so a page calling this from four different
 * components performs one query, while concurrent visitors stay isolated.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const claims = await getVerifiedClaims();
  if (!claims?.sub) return null;
  return findUserById(claims.sub);
});

/**
 * The path of the request currently being rendered.
 *
 * Server components have no direct access to the URL, so src/proxy.ts stamps it
 * onto the request as `x-pathname` on the way through. Used to build an accurate
 * `?next=` so that signing in returns you to the page you were actually trying
 * to reach.
 */
async function currentPath(fallback = "/"): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? fallback;
}

/**
 * Require any signed-in user, or redirect to the login page.
 *
 * Call this at the top of every protected page and route handler. It is not
 * redundant with the proxy check - it is the layer that actually enforces the
 * rule. Next's own docs say the proxy "should not be used as a full session
 * management or authorization solution", and a matcher pattern is one typo away
 * from letting a path through. This check cannot be routed around, because it
 * runs inside the thing being protected.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(await currentPath())}`);
  }
  return user;
}

/**
 * Require one of the given roles.
 *
 * A signed-out visitor is sent to sign in; a signed-in visitor who simply lacks
 * the role is sent to /forbidden. Bouncing the second case to the login page
 * would be a small lie - they are already logged in, and asking them to
 * authenticate again cannot fix a permissions problem.
 */
export async function requireRole(...allowed: Role[]): Promise<User> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    redirect(`/forbidden?from=${encodeURIComponent(await currentPath())}`);
  }
  return user;
}
