/**
 * Playwright's global setup/teardown run as plain Node, not through Next -
 * `.env.local` isn't loaded automatically the way `next dev` loads it for
 * the app itself. Imported first, for its side effect, by both
 * global-setup.ts and global-teardown.ts.
 */
import path from "node:path";

import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../.env.local") });
