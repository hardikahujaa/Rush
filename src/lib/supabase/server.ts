import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { createServerClient } from "@supabase/ssr";

import {
  supabaseAnonKey,
  supabaseCookieOptions,
  supabaseUrl,
} from "./env";

/**
 * Supabase client for SERVER code - server components, route handlers, server
 * actions.
 *
 * `import "server-only"` at the top turns accidentally importing this from a
 * client component into a build error rather than a runtime surprise.
 *
 * Wrapped in React's `cache()`, which memoises per REQUEST - not globally. Every
 * server component in one render tree therefore shares one client, while two
 * concurrent visitors still get entirely separate ones. Without this, a page
 * with five server components would build five clients, and if the access token
 * happened to be near expiry all five would fire their own refresh with the same
 * refresh token - which Supabase treats as token reuse.
 *
 * `cookies()` is a Promise in Next.js 16, hence async.
 */
export const createSupabaseServerClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: supabaseCookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      /**
       * The second argument is the library's cache-control headers
       * (`private, no-store`, ...). We deliberately accept and ignore it: there
       * is no supported way to set arbitrary response headers from `cookies()`,
       * because a Route Handler owns its own Response object and a Server
       * Component has none.
       *
       * That is safe here only because Next.js Route Handlers are dynamic and
       * uncached by default. It stops being safe the moment someone marks a
       * route cacheable, so the rule is recorded in CLAUDE.md: a route handler
       * that uses this client must never set `s-maxage` or `revalidate`.
       */
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch (error) {
          /**
           * Server Components are forbidden from writing cookies - by the time
           * they run, the response headers are sealed - and Next.js throws
           * rather than failing quietly.
           *
           * Ignoring THAT specific error is correct, because src/proxy.ts has
           * already refreshed the session earlier in the same request. Ignoring
           * anything else would hide real bugs: a failed cookie write during
           * sign-out, for instance, leaves the user logged in while the UI says
           * otherwise. So we rethrow everything we did not expect.
           */
          const message = error instanceof Error ? error.message : String(error);
          const isReadOnlyCookieStore =
            message.includes("Cookies can only be modified") ||
            message.includes("read-only");
          if (!isReadOnlyCookieStore) throw error;
        }
      },
    },
  });
});

/**
 * The only trustworthy way to ask "who is this?" on the server.
 *
 * Use this instead of `supabase.auth.getSession()`. `getSession()` decodes
 * whatever sits in the cookie WITHOUT checking the signature, and Supabase's own
 * documentation says its result must not be trusted on the server - a cookie is
 * client-controlled, so anyone can put anything in it. `getClaims()` verifies
 * the token against the project's signing keys first.
 *
 * Returns null when there is no valid session, so callers can branch on one
 * thing instead of remembering which of three methods is the safe one.
 */
export async function getVerifiedClaims() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return data.claims;
}
