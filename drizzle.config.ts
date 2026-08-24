import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

/**
 * Drizzle Kit config - this is the MIGRATION tool, not the runtime client.
 *
 * Note it uses DIRECT_URL (port 5432), not DATABASE_URL (port 6543). Migrations
 * issue schema changes and advisory locks that need one stable session from
 * start to finish. The transaction pooler can hand each statement to a different
 * backend connection, which breaks that. Runtime queries pool; migrations do not.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
