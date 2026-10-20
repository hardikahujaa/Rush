import * as Sentry from "@sentry/nextjs";

/**
 * Server-side Sentry init, loaded by `instrumentation.ts` for the Node runtime.
 *
 * ── UNCONFIGURED IS A SUPPORTED STATE, SAME RULE AS redis.ts ──────────────
 * `Sentry.init({ dsn: undefined })` does not throw and does not send anything -
 * the SDK treats a missing DSN as "disabled" and every capture call becomes a
 * no-op. That matters here for the same reason it matters for Redis: this repo
 * must run with no Sentry account at all, which is the state it is in right
 * now. `SENTRY_DSN` is read directly rather than through a `required()`
 * helper, because for this integration "unset" is not an error to guard
 * against - it is the default.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  /* Loud only when something is actually configured - no DSN means no init
     to report on. */
  debug: false,
});
