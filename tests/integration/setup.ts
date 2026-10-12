/**
 * Integration tests talk to the real dev Supabase Postgres - same database
 * every `tsx ... --env-file=.env.local scripts/*.ts` script already uses.
 * `dotenv` is already a devDependency; reused here instead of adding a
 * second way to load env vars. `path` is explicit because dotenv's default
 * `.env` is not the file this project actually uses.
 */
import path from "node:path";

import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env.local") });
