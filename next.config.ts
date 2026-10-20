import type { NextConfig } from "next";
/* `withSentryConfig` is a build-time-only export, so it lives at the
   package's `./config` subpath rather than the runtime root `@sentry/nextjs`
   that `Sentry.init()` is imported from elsewhere in this app. */
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

/**
 * Sentry wraps the build (source maps, release tagging), not the runtime.
 *
 * `org`/`project`/`authToken` are only needed to UPLOAD source maps to Sentry's
 * servers during `next build`. Left unset - as they are until a real Sentry
 * project exists - the plugin skips the upload step on its own and the build
 * is otherwise unaffected; `silent: true` keeps that skip from being logged as
 * though it were a failure. Nothing here requires `SENTRY_DSN` to be set: the
 * DSN only controls whether `Sentry.init()` (in `instrumentation.ts` /
 * `instrumentation-client.ts`) actually sends anything at runtime.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  /* No tunnel route: this app has no ad-blocker-sensitive audience to route
     around, and a tunnel is one more unauthenticated proxy to reason about. */
  widenClientFileUpload: true,
  /* Source maps are uploaded, never shipped - a map would hand every visitor
     readable server + client source. */
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
