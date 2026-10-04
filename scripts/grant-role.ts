/**
 * DEV-ONLY: change an account's role.
 *
 *   npm run grant-role -- you@example.com staff
 *   npm run grant-role -- you@example.com buyer      (to undo)
 *
 * ── WHY THIS IS NEEDED TO USE /scan AT ALL ─────────────────────────────────
 * The gate is restricted to `staff | organizer` in three places: the proxy
 * matcher, `requireRole` on the page, and the role check in POST /api/scan.
 * Meanwhile the seed creates exactly one non-buyer - `organizer@rush.demo` -
 * and that row has no Supabase Auth credentials, so nobody can sign in as it.
 * Every account a human can actually log into is a `buyer`.
 *
 * So without this script /scan is unreachable by design and unreachable in
 * practice, which is a poor combination.
 *
 * ── THE PART PEOPLE GET STUCK ON ───────────────────────────────────────────
 * Updating `public.users.role` fires the trigger from migration 0004, which
 * mirrors the role into `auth.users.raw_app_meta_data` - and THAT is what puts
 * it in the JWT. But a JWT already in a cookie is a snapshot: it still says
 * `buyer`, so `src/proxy.ts` keeps redirecting to /forbidden until the token
 * refreshes.
 *
 * You must SIGN OUT AND SIGN BACK IN. The script says so at the end, because
 * this is the single most confusing minute in the whole setup.
 */
import { eq } from "drizzle-orm";

import { db } from "../src/db";
import { users } from "../src/db/schema";

const ROLES = ["buyer", "organizer", "staff"] as const;
type Role = (typeof ROLES)[number];

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("grant-role is a development helper and will not run in production");
  }

  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3]?.trim();

  if (!email || !role || !isRole(role)) {
    console.error("\n  Usage: npm run grant-role -- <email> <buyer|organizer|staff>\n");
    const all = await db
      .select({ email: users.email, role: users.role })
      .from(users)
      .where(eq(users.role, "buyer"));

    /* Only accounts somebody can actually sign in as are worth listing - the
       40 seeded `@rush.demo` buyers have no auth credentials. */
    const real = all.filter((u) => !u.email.endsWith("@rush.demo"));
    if (real.length > 0) {
      console.error("  Accounts you can sign in as:\n");
      for (const u of real) console.error(`    ${u.email}  (${u.role})`);
      console.error("");
    }
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!existing) {
    throw new Error(`No user with email ${email}. Sign up at /signup first.`);
  }

  if (existing.role === role) {
    console.log(`\n  ${existing.email} is already ${role}. Nothing to do.`);
    console.log(`  (If /scan still refuses you, sign out and back in — the`);
    console.log(`   role in your current token is a snapshot.)\n`);
    return;
  }

  const previous = existing.role;
  await db.update(users).set({ role }).where(eq(users.id, existing.id));

  console.log(`\n  ${existing.email}:  ${previous}  ->  ${role}`);

  if (role === "staff" || role === "organizer") {
    console.log(`\n  ┌──────────────────────────────────────────────────────────┐`);
    console.log(`  │  NOW SIGN OUT AND SIGN BACK IN.                          │`);
    console.log(`  │                                                          │`);
    console.log(`  │  Your current session's JWT still says "${previous}".${" ".repeat(Math.max(0, 8 - previous.length))}     │`);
    console.log(`  │  src/proxy.ts reads the role from that token, so it      │`);
    console.log(`  │  will keep sending you to /forbidden until it refreshes. │`);
    console.log(`  └──────────────────────────────────────────────────────────┘`);
    console.log(`\n  Then open:  http://localhost:3000/scan`);
  }

  console.log(`\n  To undo:  npm run grant-role -- ${existing.email} ${previous}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
