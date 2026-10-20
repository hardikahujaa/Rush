import * as Sentry from "@sentry/nextjs";

/**
 * Client-side Sentry init. Resolved the same way as `proxy.ts` and
 * `instrumentation.ts` - relative to the directory containing `app` - so it
 * lives at `src/instrumentation-client.ts`.
 *
 * `NEXT_PUBLIC_SENTRY_DSN`, not `SENTRY_DSN`: this code ships to the browser,
 * so the variable has to be one Next inlines into the client bundle. A DSN is
 * meant to be public - it can only submit events, never read anything back -
 * so this is not the secret-in-a-public-var mistake `supabase/env.ts` guards
 * against. Unset, same as the server config: `Sentry.init` with no DSN is a
 * documented no-op, not a throw.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
});
