import "./env";

import { ensureFixtureEvent } from "./fixture";

/**
 * No `closeDb()` here, deliberately. Playwright runs `globalSetup` and
 * `globalTeardown` in the SAME Node process, and `src/db/index.ts` caches
 * its connection on `globalThis` outside production - so closing it here
 * would hand `globalTeardown`'s later `import "../src/db"` the same,
 * already-ended connection object instead of a fresh one. Closing happens
 * once, in `global-teardown.ts`, after the last query that needs it.
 */
export default async function globalSetup() {
  await ensureFixtureEvent();
}
