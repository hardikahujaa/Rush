/**
 * Runs before every unit test file. `src/lib/qr.ts` throws at call time if
 * `QR_SIGNING_SECRET` is unset - this stands in for the real secret so the
 * pure signing logic can be tested without `.env.local`.
 */
process.env.QR_SIGNING_SECRET ??= "unit-test-secret-do-not-use-in-prod";
