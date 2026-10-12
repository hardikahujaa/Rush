import { defineConfig, devices } from "@playwright/test";

/**
 * T43's one E2E test: the full buyer path against a REAL dev server, REAL
 * Supabase Auth, and a REAL (test-mode) Stripe Checkout - nothing mocked,
 * matching this project's "test the real thing" ethos everywhere else
 * (T21's race proof, T42's load test).
 *
 * ── TWO THINGS THIS CANNOT START FOR YOU ───────────────────────────────────
 * 1. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` must be
 *    running in a separate terminal. The success page polls order status,
 *    and the order only flips to "paid" when Stripe's webhook actually
 *    reaches the app - which in local dev only happens through that tunnel.
 *    Without it the test will time out on the success page, not fail fast.
 * 2. `.env.local` must already be populated (same as every other script in
 *    this repo) - this config only starts `next dev`, it doesn't configure
 *    Supabase or Stripe.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
