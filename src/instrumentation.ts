/**
 * Next's instrumentation hook. Like `proxy.ts`, this is resolved from the
 * directory that CONTAINS `app` - this project uses `src/app`, so it lives at
 * `src/instrumentation.ts`, not the repo root. Getting that wrong is the same
 * silent failure AGENTS.md warns about for the proxy: the file is simply never
 * loaded, with no error anywhere.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Next's hook for errors it catches itself - a render that throws, a route
 * handler that rejects without being caught, a Server Action failure. Without
 * this, Sentry only ever sees errors this app explicitly reports; with it,
 * the ones that reach Next's own boundary are captured too.
 */
export const onRequestError = async (
  ...args: Parameters<
    typeof import("@sentry/nextjs").captureRequestError
  >
) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(...args);
};
