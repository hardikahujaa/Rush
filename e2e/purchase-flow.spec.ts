import { expect, test } from "@playwright/test";

import { FIXTURE_TITLE } from "./fixture";

/**
 * T43's one E2E test: sign up -> browse -> select seats -> hold -> checkout
 * with the Stripe test card -> success page. See playwright.config.ts's
 * module comment for the two things that must already be running
 * (`stripe listen` and the dev server's `.env.local`).
 *
 * ── SIGNUP: WHY NO ADMIN-API WORKAROUND WAS NEEDED ─────────────────────────
 * `src/app/(auth)/actions.ts` only shows "check your email" when Supabase's
 * own `signUp()` returns no session. Checked this project's actual Auth
 * settings (`GET {SUPABASE_URL}/auth/v1/settings`): `mailer_autoconfirm` is
 * `true`, so signup returns a session immediately and `actions.ts` redirects
 * straight to `/` - the literal brief ("sign up ... checkout ... success")
 * works with no deviation.
 */
test("buyer can sign up, browse, hold a seat, pay, and see a confirmed order", async ({
  page,
}) => {
  const uniqueEmail = `e2e+${Date.now()}@example.com`;

  // ── 1. Sign up ───────────────────────────────────────────────────────────
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E Test Buyer");
  await page.getByLabel("Email").fill(uniqueEmail);
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();

  // mailer_autoconfirm means this lands signed in on the homepage, not on
  // the "check your email" screen.
  await expect(page).toHaveURL("/");

  // ── 2. Browse to the dedicated fixture event ─────────────────────────────
  // Reuses the navbar's existing `?q=` title search instead of paging
  // through every event in the catalogue - deterministic regardless of how
  // much other seed/demo data exists.
  await page.goto(`/events?q=${encodeURIComponent("E2E TEST")}`);
  const eventLink = page.getByRole("link", { name: new RegExp(FIXTURE_TITLE) });
  await expect(eventLink).toBeVisible();
  await eventLink.click();

  // The event is already dropped, so `EventCard` links straight to
  // `/events/[id]/seats` - no detail page in between.
  await expect(page).toHaveURL(/\/events\/[^/]+\/seats$/);

  // ── 3. Select one seat and hold it ───────────────────────────────────────
  // `/available/i` would also match "...on hold, unavailable" - anchoring on
  // the ", available" suffix `SeatButton`'s label always ends with in the
  // genuinely-free case rules that out.
  const availableSeat = page
    .getByRole("button", { name: /, available$/i })
    .first();
  await expect(availableSeat).toBeVisible();
  await availableSeat.click();

  await page.getByRole("button", { name: "Hold seats" }).click();

  // HoldBanner replaces CheckoutBar once the hold succeeds.
  const payButton = page.getByRole("button", { name: "Proceed to Payment" });
  await expect(payButton).toBeVisible({ timeout: 15_000 });

  // ── 4. Checkout with Stripe's test card ──────────────────────────────────
  await payButton.click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20_000 });

  // No email field to fill: `buildCheckoutSession` passes `customer_email`,
  // so Stripe renders it as read-only static text, not an input (confirmed
  // against the real rendered page, not assumed).
  await page.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
  await page.getByPlaceholder("MM / YY").fill("12/34");
  await page.getByPlaceholder("CVC").fill("123");
  await page.getByLabel("Cardholder name").fill("E2E Test Buyer");

  await page.getByRole("button", { name: "Pay" }).click();

  // ── 5. Land on the success page and wait for the webhook to confirm it ──
  // Stripe redirects synchronously; the order only flips to "paid" once
  // `stripe listen` forwards `checkout.session.completed` to our webhook -
  // asynchronous relative to this redirect, hence the generous timeout.
  await page.waitForURL(/\/orders\/[^/]+\/success/, { timeout: 30_000 });
  // `SuccessView`'s "You're going." heading is `aria-hidden="true"` - the
  // paid state is announced to assistive tech once, through this sibling
  // `role="status"` live region, instead of twice. This text renders only
  // once `settled === "confirmed"`, i.e. once the webhook actually marked
  // the order "paid", not just once Stripe redirected here.
  await expect(page.getByRole("status").getByText("Payment confirmed")).toBeVisible(
    { timeout: 30_000 },
  );
});
