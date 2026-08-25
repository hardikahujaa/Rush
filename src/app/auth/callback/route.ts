import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where Supabase sends people after they click a confirmation or magic link.
 *
 * The link carries a one-time `code`. This route trades that code for a real
 * session and sets the cookies. That exchange has to happen server-side: the
 * code is single-use and short-lived, and completing it here means the session
 * cookie is written by our own server rather than assembled in the browser.
 *
 * NOTE: this route must never be cached (see CLAUDE.md). Route handlers are
 * dynamic by default, and this one reads cookies, so it stays dynamic - but do
 * not add `revalidate` or `s-maxage` here.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  /**
   * Supabase reports link failures as query params rather than an HTTP error,
   * so an expired link arrives here looking like a normal request with no code.
   * Without this branch the user would be bounced to the homepage as though
   * nothing happened, with no idea why they are still logged out.
   */
  const authError = searchParams.get("error_description") ?? searchParams.get("error");
  if (authError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(authError)}`, origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("That link has expired or has already been used. Try signing in again.")}`,
        origin,
      ),
    );
  }

  // `origin` comes from the request Next has already resolved, and `next` has
  // been sanitised, so this cannot be pointed at another site.
  return NextResponse.redirect(new URL(next, origin));
}
