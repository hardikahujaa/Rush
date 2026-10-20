import * as Sentry from "@sentry/nextjs";

/**
 * Edge-runtime Sentry init, loaded by `instrumentation.ts` for the edge runtime.
 *
 * `src/proxy.ts` is Node-runtime only (CLAUDE.md - edge is unsupported for a
 * Next 16 proxy, and the runtime cannot be configured), so nothing in this
 * app actually runs on the edge today. This file exists anyway because
 * `instrumentation.ts` must import something for `NEXT_RUNTIME === "edge"`,
 * and Next reserves the right to run other internals there - better an inert
 * init than a missing one if that ever changes. Same "unconfigured is
 * supported" rule as `sentry.server.config.ts`.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
});
