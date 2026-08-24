/**
 * Supabase environment variables, read once and validated loudly.
 *
 * These are written as literal `process.env.NEXT_PUBLIC_*` property accesses
 * rather than a dynamic lookup, because Next.js inlines public env vars into the
 * client bundle at build time by matching that exact text. A computed access
 * like `process.env[name]` typechecks fine and is then `undefined` in the
 * browser.
 */

function required(value: string | undefined, name: string): string {
  if (!value || value.length === 0) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

/**
 * Refuses a secret key in a public variable.
 *
 * `NEXT_PUBLIC_*` values are compiled into the JavaScript every visitor
 * downloads. The anon/publishable key belongs there - it is public by design and
 * is constrained by row level security. The service_role key is the opposite: it
 * bypasses RLS entirely. The two sit next to each other on the same Supabase
 * dashboard page and look alike, so pasting the wrong one is a plausible
 * slip - and one that would hand every visitor full read/write access to the
 * seat inventory, with nothing failing or logging.
 *
 * A length check cannot tell them apart. These two markers can:
 *   - new-style keys are prefixed `sb_secret_` vs `sb_publishable_`
 *   - legacy keys are JWTs carrying a readable `"role":"service_role"` claim
 */
function assertNotSecretKey(value: string, name: string): string {
  if (value.startsWith("sb_secret_")) {
    throw new Error(
      `${name} looks like a SECRET key (sb_secret_...). It would be compiled ` +
        `into the browser bundle. Use the publishable/anon key instead.`,
    );
  }

  // Legacy JWT-style keys: decode the payload and look at the role claim.
  const parts = value.split(".");
  if (parts.length === 3) {
    try {
      const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      if (JSON.parse(json).role === "service_role") {
        throw new Error(
          `${name} is a SERVICE_ROLE key. It bypasses row level security and ` +
            `would be compiled into the browser bundle. Use the anon key.`,
        );
      }
    } catch (e) {
      // Only re-throw our own error; a malformed payload is not our business
      // here - the Supabase client rejects a bad key on first use.
      if (e instanceof Error && e.message.includes("SERVICE_ROLE")) throw e;
    }
  }

  return value;
}

export const supabaseUrl = required(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "NEXT_PUBLIC_SUPABASE_URL",
);

export const supabaseAnonKey = assertNotSecretKey(
  required(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ),
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);

/**
 * Cookie options applied to every Supabase auth cookie.
 *
 * `httpOnly` stays false and that is not an oversight - @supabase/ssr's browser
 * client reads the session cookie from `document.cookie`, so hiding it from
 * JavaScript would break client-side auth entirely. That is a deliberate
 * trade-off in the library's design.
 *
 * `secure` is NOT set by the library's defaults, and that one is worth fixing:
 * without it the browser will send the session cookie over plain HTTP, where
 * anything on the network path can read it. Off in development because
 * localhost is not HTTPS.
 */
export const supabaseCookieOptions = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
} as const;
