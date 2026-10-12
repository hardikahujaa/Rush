import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * ── WHY `server-only` NEEDS AN ALIAS, NOT JUST A RESOLVE CONDITION ─────────
 * Most of the code under test (`src/lib/qr.ts`, `src/db/queries/*.ts`, ...)
 * starts with `import "server-only"`. That package's export map resolves to
 * an unconditionally THROWING `index.js` by default, and only resolves to a
 * no-op module under the `react-server` condition - which is exactly why
 * every `tsx` script in package.json runs with `--conditions=react-server`.
 *
 * Setting `resolve.conditions: ["react-server"]` alone doesn't fix this
 * under Vitest: by default Vitest externalizes node_modules packages,
 * meaning they're loaded through plain Node resolution rather than Vite's
 * resolver, so Vite's `conditions` setting never gets consulted for them.
 * Aliasing the package straight to an empty stub sidesteps that gap instead
 * of fighting it.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
      "server-only": path.resolve(rootDir, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/unit/setup.ts", "tests/integration/setup.ts"],
  },
});
