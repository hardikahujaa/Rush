/**
 * Proves the T15 route guards actually bite, for every role.
 *
 *   node --env-file=.env.local scripts/rbac-test.mjs [baseUrl]
 *
 * Sessions are minted through @supabase/ssr itself with a capturing cookie
 * store, so the cookies sent here are byte-for-byte what the browser would
 * send - no hand-rolled token format that could drift from the library's.
 */
import { createServerClient } from "@supabase/ssr";
import postgres from "postgres";

const BASE = process.argv[2] ?? "http://localhost:3000";
const EMAIL = "hardik.demo@rushtickets.dev";
const PASSWORD = "correct-horse-battery";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });

let failures = 0;

/** Sign in and return a Cookie header carrying the resulting session. */
async function sessionCookie() {
  const jar = new Map();
  const sb = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function check(path, cookie, expect) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  const loc = res.headers.get("location") ?? "";
  const dest = loc.replace(BASE, "");

  let actual;
  if (res.status === 200) actual = "allow";
  else if (dest.startsWith("/login")) actual = "login";
  else if (dest.startsWith("/forbidden")) actual = "forbidden";
  /**
   * A 404 means the guard let this request THROUGH and the app then found no
   * such route - which is the correct outcome for an authorised user asking for
   * a path that does not exist. It is a pass, not a bypass: the thing being
   * tested is whether the gate ran, not whether the page exists.
   */
  else if (res.status === 404) actual = "passed-gate-404";
  else actual = `${res.status} ${dest}`;

  const ok = actual === expect;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${path.padEnd(24)} expect ${expect.padEnd(10)} got ${actual}`,
  );
}

async function setRole(role) {
  await sql`update public.users set role = ${role} where email = ${EMAIL}`;
}

console.log(`\ntarget: ${BASE}`);

/* -- signed out ------------------------------------------------------- */
console.log("\nSIGNED OUT");
for (const p of ["/dashboard", "/tickets", "/organizer", "/scan", "/organizer/report.png"]) {
  await check(p, null, "login");
}
for (const p of ["/", "/login", "/signup"]) await check(p, null, "allow");

/* -- buyer ------------------------------------------------------------ */
await setRole("buyer");
let cookie = await sessionCookie();
console.log("\nSIGNED IN AS buyer");
await check("/dashboard", cookie, "allow");
await check("/organizer", cookie, "forbidden");
await check("/organizer/report.png", cookie, "forbidden");
await check("/scan", cookie, "forbidden");

/* -- staff ------------------------------------------------------------ */
await setRole("staff");
cookie = await sessionCookie();
console.log("\nSIGNED IN AS staff");
await check("/dashboard", cookie, "allow");
await check("/scan", cookie, "allow");
await check("/organizer", cookie, "forbidden");

/* -- organizer -------------------------------------------------------- */
await setRole("organizer");
cookie = await sessionCookie();
console.log("\nSIGNED IN AS organizer");
await check("/dashboard", cookie, "allow");
await check("/organizer", cookie, "allow");
await check("/organizer/report.png", cookie, "passed-gate-404");
await check("/scan", cookie, "allow");

/* -- the stale-token case --------------------------------------------- */
/* Demote to buyer WITHOUT re-issuing the token. The cookie still claims
   organizer, so the proxy's fast path waves it through - and the database check
   inside the page must catch it anyway. This is the test that proves the second
   layer is real rather than decorative. */
console.log("\nSTALE TOKEN (cookie says organizer, database says buyer)");
await setRole("buyer");
await check("/organizer", cookie, "forbidden");

await setRole("buyer");
await sql.end();
console.log(
  failures === 0
    ? "\nAll route guards behave correctly.\n"
    : `\n${failures} GUARD CHECK(S) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
