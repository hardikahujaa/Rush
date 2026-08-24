import { NextResponse, type NextRequest } from "next/server";

import { createServerClient } from "@supabase/ssr";

import {
  supabaseAnonKey,
  supabaseCookieOptions,
  supabaseUrl,
} from "@/lib/supabase/env";

/**
 * Runs before every matched request.
 *
 * LOCATION MATTERS. In Next.js 16 this file is `proxy.ts`, not `middleware.ts`,
 * and it must sit at the same level as the `app` directory. This project uses
 * `src/app`, so the file belongs at `src/proxy.ts` - NOT the repo root, despite
 * what most guides (and PLAN.md) say. Next scans that one directory
 * non-recursively; put it anywhere else and it is simply never found. There is
 * no warning and no error: `next build` succeeds, `next dev` starts fine,
 * typechecking passes, and every request silently skips this code.
 *
 * To confirm it IS registered, look for the line `f Proxy (Middleware)` in the
 * `next build` route summary. Do not use `.next/server/middleware-manifest.json`
 * for this - that manifest tracks EDGE middleware and stays empty either way,
 * because a Next 16 proxy runs on the Node.js runtime.
 *
 * The exported function must be named `proxy`. It runs on the Node.js runtime;
 * the edge runtime is unsupported here and cannot be configured.
 *
 * Its job in T13 is keeping the session alive. Supabase access tokens are
 * short-lived and get traded for fresh ones using a refresh token. Server
 * Components cannot write cookies - their response headers are already sealed by
 * the time they run - so if the refresh did not happen here, the new token would
 * have nowhere to go and users would be logged out at random.
 */
export async function proxy(request: NextRequest) {
  /**
   * Cookies are COLLECTED, not written straight onto a response.
   *
   * The obvious implementation rebuilds the response inside `setAll`. That
   * quietly breaks if `setAll` fires more than once in a request - which it can,
   * since the library calls it on token refresh and again for PKCE verifier
   * writes - because `NextResponse.next()` returns a brand new Response and
   * throws away whatever the previous call had already set.
   *
   * Collecting them means the response is built exactly once, from the complete
   * set, and any response we choose to return (including a redirect in T15) can
   * be given the same cookies.
   */
  const pendingCookies: {
    name: string;
    value: string;
    options: Record<string, unknown>;
  }[] = [];
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: supabaseCookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Update the REQUEST cookies too, so anything rendering downstream in
        // this same pass reads the new token rather than the expired one.
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          pendingCookies.push({ name, value, options });
        }
        /**
         * SECURITY, not housekeeping.
         *
         * Supabase hands us `Cache-Control: private, no-store` and friends
         * alongside the cookies. A response carrying a `Set-Cookie` for a session
         * token must never be cached by a CDN - Vercel's edge sits in front of
         * this app, and a cached auth response would serve one user's session to
         * whoever asked next. Dropping these headers is a session-takeover bug,
         * not a performance nit.
         */
        Object.assign(pendingHeaders, headers);
      },
    },
  });

  /**
   * Nothing may go between `createServerClient` above and this call.
   *
   * The client initialises lazily - nothing is read, refreshed or written until
   * the first `getClaims()`/`getUser()`/`getSession()`. Any early return in
   * between would ship a response whose session was never refreshed: the classic
   * cause of "it logs me out every few minutes".
   *
   * `getClaims()` rather than `getSession()` is deliberate. `getSession()`
   * decodes the cookie WITHOUT verifying its signature, and Supabase's own docs
   * say its result must not be trusted server-side, because cookies are
   * client-controlled and can be forged. `getClaims()` verifies the JWT against
   * the project's signing keys first.
   */
  const { data, error } = await supabase.auth.getClaims();

  const response = NextResponse.next({ request });
  applyPending(response, pendingCookies, pendingHeaders);

  /**
   * T15 will add role-based redirects here, using `data?.claims.sub` as the
   * verified user id. Any redirect MUST be passed through `applyPending` too,
   * or the refreshed session is lost on exactly the request that redirects:
   *
   *   const redirect = NextResponse.redirect(url)
   *   applyPending(redirect, pendingCookies, pendingHeaders)
   *   return redirect
   *
   * `error` is captured rather than ignored so T15 can distinguish "no session"
   * from "the auth service is unreachable" - those deserve different behaviour,
   * and re-calling getClaims() to find out would cost another round trip.
   */
  void data;
  void error;

  return response;
}

function applyPending(
  response: NextResponse,
  cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) {
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set({ name, value, ...options });
  }
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
}

export const config = {
  matcher: [
    /**
     * Everything except Next's build output and TOP-LEVEL static files.
     *
     * The `[^/]+\.ext$` shape is load-bearing. The commonly copy-pasted version
     * uses `.*\.ext$`, which excludes any path whose last segment ends in that
     * extension - including nested, user-controlled ones. Under that pattern a
     * request to `/organizer/report.png` skips this file entirely, so once T15
     * adds role checks here, an attacker picks their own path and walks around
     * the gate. `[^/]+` cannot cross a slash, so only real top-level assets like
     * `/next.svg` and `/robots.txt` are exempt.
     *
     * Even so, this is an optimistic gate. Next's own docs are explicit that
     * proxy "should not be used as a full session management or authorization
     * solution" - so T15 must ALSO check authorisation inside the page or route
     * handler itself, with row level security underneath. This is the fast path,
     * never the only one.
     */
    "/((?!_next/static|_next/image|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
