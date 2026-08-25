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
 * TWO JOBS:
 *   1. Keep the session alive. Supabase access tokens are short-lived and get
 *      traded for fresh ones. Server Components cannot write cookies - their
 *      response headers are sealed by the time they run - so without the refresh
 *      happening here the new token would have nowhere to go and users would be
 *      logged out at random.
 *   2. Turn obviously unauthorised requests away before any page renders.
 */

/** Roles as they appear in the `app_metadata.role` claim. */
type Role = "buyer" | "organizer" | "staff";

/**
 * Route protection rules, most specific first.
 *
 * `roles: null` means "any signed-in user will do".
 */
const RULES: { prefix: string; roles: Role[] | null }[] = [
  { prefix: "/organizer", roles: ["organizer"] },
  { prefix: "/scan", roles: ["staff", "organizer"] },
  { prefix: "/dashboard", roles: null },
  { prefix: "/tickets", roles: null },
];

function ruleFor(pathname: string) {
  return RULES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
}

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
   * set, and every response below - including the redirects - carries them.
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
   * the project's signing keys first - which is what makes the role check below
   * safe to base on it.
   */
  const { data, error } = await supabase.auth.getClaims();

  const pathname = request.nextUrl.pathname;
  const rule = ruleFor(pathname);

  /**
   * Stamp the path onto the REQUEST so server components can read it.
   *
   * A server component cannot see its own URL. src/lib/auth.ts reads this header
   * to build an accurate `?next=` when it has to send someone to sign in.
   *
   * `set` (not `append`) is deliberate: it REPLACES any `x-pathname` the caller
   * sent us. A client can put whatever it likes in a request header, so if this
   * appended instead, a forged value would sit alongside ours in a header our
   * own code then trusts.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  const nextResponseInit = { request: { headers: requestHeaders } };

  if (rule) {
    const claims = data?.claims;
    const signedIn = Boolean(claims?.sub) && !error;

    if (!signedIn) {
      // Fail CLOSED. If the auth service was unreachable we genuinely do not
      // know who this is, and the safe answer to "may I see the dashboard?"
      // when we cannot tell is no.
      return redirectTo(
        request,
        `/login?next=${encodeURIComponent(pathname)}`,
        pendingCookies,
        pendingHeaders,
      );
    }

    if (rule.roles) {
      const appMetadata = claims?.app_metadata as
        | { role?: string }
        | undefined;
      const role = appMetadata?.role as Role | undefined;

      /**
       * A token with no role claim at all is NOT treated as a denial.
       *
       * That happens for tokens minted before the role sync existed, and for the
       * hour after someone is promoted but before their token refreshes. Denying
       * would lock a legitimately promoted organizer out of their own dashboard
       * until their token happened to roll over. Letting it through costs
       * nothing, because requireRole() in the page reads the role from the
       * database and is the check that actually decides.
       */
      if (role && !rule.roles.includes(role)) {
        return redirectTo(
          request,
          `/forbidden?from=${encodeURIComponent(pathname)}`,
          pendingCookies,
          pendingHeaders,
        );
      }
    }
  }

  const response = NextResponse.next(nextResponseInit);
  applyPending(response, pendingCookies, pendingHeaders);
  return response;
}

function redirectTo(
  request: NextRequest,
  to: string,
  cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) {
  /**
   * `new URL(to, request.nextUrl)` resolves against THIS origin, so a redirect
   * can never be pointed at another site even if `to` were ever built from
   * request data.
   */
  const response = NextResponse.redirect(new URL(to, request.nextUrl));
  /**
   * The refreshed session must be carried onto the redirect as well. Returning a
   * bare redirect here would discard the new cookies on exactly the requests
   * that redirect - so a user whose token refreshed while being bounced to the
   * login page would arrive there freshly signed out.
   */
  applyPending(response, cookiesToSet, headers);
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
     * request to `/organizer/report.png` skips this file entirely and walks
     * straight around the role check above. `[^/]+` cannot cross a slash, so only
     * real top-level assets like `/next.svg` and `/robots.txt` are exempt.
     *
     * Even so, this is an optimistic gate. Next's own docs are explicit that
     * proxy "should not be used as a full session management or authorization
     * solution", which is why every protected page ALSO calls requireUser() or
     * requireRole() from src/lib/auth.ts. This is the fast path, never the only
     * one.
     */
    "/((?!_next/static|_next/image|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
