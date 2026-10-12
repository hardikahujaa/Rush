import "./env";

import { deleteFixtureEvent } from "./fixture";

/**
 * No `closeDb()` here either (see global-setup.ts's note on why not). It
 * also isn't needed for the reason it exists in one-shot `tsx` scripts:
 * Playwright force-exits its own process once teardown resolves, rather
 * than waiting for Node's event loop to drain - racing an in-flight
 * `conn.end()` against that forced exit is what tripped a libuv assertion
 * on Windows (`src/win/async.c`) during development. Leaving the socket for
 * the OS to reclaim at process exit is what every other Playwright run
 * already does for whatever connections its own browser/server hold.
 */
export default async function globalTeardown() {
  await deleteFixtureEvent();
}
