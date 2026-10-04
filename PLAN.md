# Rush — Build Pipeline

**High-demand ticket drop platform.** Next.js 16 · TypeScript · Supabase (Postgres) · Drizzle · Upstash Redis · Stripe · Vercel

> **How to use this file:** Keep it at the root of your repo as `PLAN.md`. Claude Code reads your repo, so it can always see this and know where you are. Do one task per Claude Code session. When a task is done, tick the box, commit, and run `/clear` before starting the next one.

---

## Ground rules

1. **One task = one Claude Code conversation = one git commit.** Run `/clear` between tasks. A long, messy conversation makes Claude Code worse, not better.
2. **Never accept code you don't understand.** After it writes something, ask: `Explain what you just wrote line by line. I'm new to React and TypeScript.` This is the whole point — you're learning, not collecting files.
3. **Use Plan Mode for anything non-trivial.** Press `Shift+Tab` twice to enter it. Claude Code proposes a plan, you approve it, *then* it writes code. Use this for every task marked 🔴.
4. **Commit after every task.** If something breaks later, you can always go back.
5. **When stuck:** paste the *full* error into Claude Code and say `This is the error. Diagnose the root cause before changing anything.` Don't let it guess-and-check.

**Difficulty key:** 🟢 mechanical · 🟡 needs attention · 🔴 core logic — use Plan Mode, read the explanation twice

---

## PHASE 0 — Setup (do this before touching code)

### ☑ T00 — Accounts
Sign up for all of these first so you never get blocked mid-session. All free unless noted.

| Service | URL | Note |
|---|---|---|
| GitHub | github.com | Sign up for the **Student Developer Pack** too — free domain + credits |
| Vercel | vercel.com | Sign in **with GitHub** |
| Supabase | supabase.com | Sign in with GitHub |
| Upstash | upstash.com | Sign in with GitHub |
| Stripe | stripe.com | Test mode only — no bank details needed |
| Resend | resend.com | Email sending |
| Sentry | sentry.io | Error tracking |

**Claude Code requires a paid Claude plan** (Pro, Max, Team, or Enterprise) or a Console API key — the free plan doesn't include it. Sort this out now, not on Day 1.

---

### ☑ T01 — Install Claude Code (Windows, native — no WSL needed)

Open **PowerShell** and run:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Then **close and reopen PowerShell** (the installer adds it to your PATH, which needs a fresh session), and verify:

```powershell
claude --version
claude doctor
```

`claude doctor` checks your install, auth, and config — run it any time something feels wrong.

> **Windows tip:** if you have **Git for Windows** installed, Claude Code uses the Bash tool via Git Bash instead of PowerShell. That's better — nearly every example online assumes Unix-style commands. You already have Git, so you should be fine.

**Verify:** `claude --version` prints a version number.

---

### ☐ T02 — Learn the 6 Claude Code commands you'll actually use

Run `claude` in any folder and try these:

| Command | What it does | When you'll use it |
|---|---|---|
| `/init` | Scans the repo, writes a `CLAUDE.md` context file | Once, at T06 |
| `Shift+Tab` ×2 | **Plan Mode** — proposes before writing | Every 🔴 task |
| `/clear` | Wipes conversation, keeps the repo | Between every task |
| `/undo` | Reverts the last change | When it goes sideways |
| `Esc` | Interrupt mid-response | When it's heading the wrong way |
| `@filename` | Pull a specific file into context | `@src/db/schema.ts` constantly |

**Verify:** you've entered and exited Plan Mode once.

---

## PHASE 1 — Foundation & first deploy

### ☑ T03 🟢 — Create the Next.js project

In PowerShell, in a folder like `C:\projects`:

```powershell
npx create-next-app@latest rush
```

Answer: **TypeScript → Yes · ESLint → Yes · Tailwind → Yes · `src/` directory → Yes · App Router → Yes · Turbopack → Yes · import alias → No**

```powershell
cd rush
npm run dev
```

**Verify:** `http://localhost:3000` shows the Next.js welcome page.
**Commit:** `chore: initialise next.js project`

---

### ☑ T04 🟢 — Push to GitHub

```powershell
git init
git add .
git commit -m "chore: initialise next.js project"
```

Create an **empty** repo named `rush` on GitHub (no README, no .gitignore), then:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/rush.git
git branch -M main
git push -u origin main
```

**Verify:** your code is visible on github.com.

---

### ☐ T05 🟢 — Deploy to Vercel (yes, on day one)

1. vercel.com → **Add New → Project** → import `rush`
2. Leave every setting default → **Deploy**

**Verify:** you have a live `https://rush-xxxx.vercel.app` URL. Send it to someone. It's real now.

> From here on, **every push to `main` auto-deploys.** Every pull request gets its own preview URL.

---

### ☑ T06 🟡 — Give Claude Code its project brain

Copy this `PLAN.md` into your repo root. Then start Claude Code in the project folder and run `/init`.

Then, **prompt:**

> Read PLAN.md in the repo root. Rewrite CLAUDE.md so it captures: the project purpose (a high-demand ticket drop platform), the full tech stack, the folder structure convention we'll use, and these rules for you: (1) always use TypeScript strict mode, (2) validate every API input with Zod, (3) never write raw SQL outside `src/db/`, (4) explain new concepts because the developer is a beginner in React and TypeScript, (5) prefer server components unless client interactivity is required.

**Why this matters:** `CLAUDE.md` is loaded into context automatically every session. Ten minutes here saves you from repeating yourself sixty times.

**Commit:** `docs: add project plan and claude context`

---

### ☑ T07 🟢 — Install the UI toolkit

**Prompt:**

> Set up shadcn/ui in this project using the CLI. Then install framer-motion, lucide-react, and zod. Add a dark theme as the default in the root layout. Show me the commands you're running and explain what shadcn/ui actually is — I've never used it.

**Verify:** `npm run dev` still works; page background is dark.
**Commit:** `chore: add shadcn/ui, framer-motion, zod`

---

## PHASE 2 — Database

### ☐ T08 🟡 — Create the Supabase project

1. supabase.com → New Project. Name it `rush`. **Save the database password somewhere** — you cannot recover it.
2. Region: pick the one closest to India (Mumbai / Singapore).
3. Go to **Project Settings → Database → Connection string → URI**. Copy it.
4. Go to **Project Settings → API**. Copy the Project URL and the `anon` key and the `service_role` key.

Create `.env.local` in your project root:

```
DATABASE_URL="postgresql://..."
NEXT_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

**Verify:** `.env.local` is listed in `.gitignore`. Check this. If you commit secrets to GitHub, they're public forever.

---

### ☑ T09 🔴 — The database schema

**Prompt (use Plan Mode):**

> Set up Drizzle ORM with the Postgres driver, connected via DATABASE_URL. Create `src/db/schema.ts` with these tables and relations:
>
> - `users` (id uuid pk, email unique, name, role enum['buyer','organizer','staff'] default 'buyer', createdAt)
> - `venues` (id, name, city, createdAt)
> - `events` (id, venueId→venues, organizerId→users, title, description, posterUrl, dropAt timestamp, startsAt timestamp, status enum['draft','scheduled','live','ended'], createdAt)
> - `sections` (id, eventId→events, name, priceCents integer)
> - `seats` (id, eventId→events, sectionId→sections, rowLabel, seatNo integer, status enum['available','held','sold'])
> - `holds` (id, seatId→seats, userId→users, expiresAt timestamp, releasedAt timestamp nullable, createdAt)
> - `orders` (id, userId→users, eventId→events, totalCents, status enum['pending','paid','failed','refunded'], stripeSessionId, createdAt)
> - `orderItems` (id, orderId→orders, seatId→seats, priceCents)
> - `tickets` (id, orderId→orders, seatId→seats, qrSignature text, checkedInAt timestamp nullable)
> - `webhookEvents` (id, stripeEventId unique, processedAt)
>
> Also configure `drizzle.config.ts`. Then explain to me what an ORM is, what a migration is, and why we use `sectionId` on seats rather than storing the price on every seat row.

**Verify:** `src/db/schema.ts` exists and `npx drizzle-kit generate` produces a SQL migration file.
**Commit:** `feat: database schema`

---

### ☑ T10 🟡 — Push the schema and add the safety constraints

**Prompt:**

> Run the Drizzle migration against the database. Then create a new SQL migration file adding these three constraints, and explain in detail what each one prevents:
>
> ```sql
> CREATE UNIQUE INDEX one_live_hold_per_seat ON holds (seat_id) WHERE released_at IS NULL;
> CREATE UNIQUE INDEX one_sold_seat ON order_items (seat_id);
> CREATE INDEX seats_event_status ON seats (event_id, status);
> ```

**Verify:** open Supabase → Table Editor. All 10 tables are there.
**Commit:** `feat: database constraints and indexes`

> 🎓 **These three lines are a chunk of your grade.** The first one means that even if your application code has a bug, the *database itself* will refuse to give one seat to two people. Be able to explain that.

---

### ☑ T11 🟡 — Seed data

**Prompt:**

> Write `src/db/seed.ts` that clears and repopulates the database with: 1 venue ("Nehru Indoor Stadium", Chennai), 3 events with different statuses (one live, one scheduled to drop in 2 minutes, one ended), 3 sections per event (Front ₹4999, Middle ₹2499, Rear ₹999), and seats for each section arranged in rows A-H with 12 seats per row. Add an npm script `db:seed`. Mark a random 20% of seats as already sold so the seat map doesn't look empty.

**Verify:** `npm run db:seed` runs; Supabase Table Editor shows ~288 seats per event.
**Commit:** `feat: seed script`

---

### ☑ T12 🟢 — Draw the ER diagram

**Prompt:**

> Read `@src/db/schema.ts` and generate a Mermaid ER diagram of all tables and relationships. Put it in `docs/erd.md` with a short paragraph explaining the design decisions.

**Verify:** GitHub renders the diagram when you view `docs/erd.md`.
**Commit:** `docs: ER diagram`

---

## PHASE 3 — Authentication

### ☑ T13 🔴 — Supabase Auth wiring

**Prompt (Plan Mode):**

> Set up Supabase Auth using `@supabase/ssr`. Create the browser client, the server client, and `proxy.ts` at the project root for session refresh.

> Note: this project is Next.js 16, where the middleware file is named `proxy.ts`, not `middleware.ts`. Then explain the difference between a server component and a client component, and why auth needs both clients.

> ⚠️ **CORRECTION (verified against Next 16.3.2 bundled docs + a runtime test):** `proxy.ts` does **not** belong at the project root in this repo. Next resolves it in the directory that *contains* `app`, scanned non-recursively — and we use `src/app`, so it must be **`src/proxy.ts`**. At the root it is silently never loaded: `next build` succeeds, `next dev` starts, `tsc` passes, and every single request skips it. Confirm it is wired by looking for `f Proxy (Middleware)` in the `npm run build` route summary — NOT by checking `middleware-manifest.json`, which tracks edge middleware and stays empty regardless.

**Verify:** `npm run build` prints `f Proxy (Middleware)` in the route summary. (PLAN.md originally said "npm run dev runs without errors" — that passes even when the proxy is never loaded, so it does not actually check anything.)
**Commit:** `feat: supabase auth clients`

---

### ☑ T14 🟡 — Login and signup pages

**Prompt:**

> Build `/login` and `/signup` pages using shadcn/ui form components and email+password auth. Validate inputs with Zod. Show inline error messages. On successful signup, insert a matching row into our `users` table with role 'buyer'. Add a `/auth/callback` route handler. Keep the design dark and minimal.

**Verify:** you can create an account and see the row appear in the Supabase `users` table.
**Commit:** `feat: login and signup`

---

### ☑ T15 🟡 — Route protection and roles

**Prompt:**

> In `proxy.ts`, protect these routes: `/dashboard` requires any logged-in user, `/organizer/*` requires role 'organizer', `/scan` requires role 'staff' or 'organizer'. Redirect unauthorised users to `/login?next=<path>`. Create a `getCurrentUser()` helper in `src/lib/auth.ts` that returns the user joined with their role from our users table. Explain how middleware/proxy runs before the page does.

**Verify:** logged out, visiting `/dashboard` bounces you to `/login`.
**Commit:** `feat: RBAC route protection`

---

### ☑ T16 🟢 — Navbar with auth state

**Prompt:**

> Build a sticky navbar server component showing the logo, event links, and either Login/Signup buttons or a user dropdown with Sign Out. Add subtle Framer Motion entrance animation. Make it responsive with a mobile sheet menu.

**Commit:** `feat: navbar`

---

## PHASE 4 — Public pages

### ☑ T17 🟡 — Events listing page

**Prompt:**

> Build `/events` as a server component that queries all events with their venue and a computed count of available seats. Render them as animated cards showing poster, title, venue, date, price range, and a status badge. Add a loading.tsx skeleton. Explain how server components fetch data without an API route, and why that's different from what I'd do with plain React.

**Commit:** `feat: events listing`

**Done — and scoped wider than the brief, because the brief's page was only half
the problem.** T17 asks for `/events`. The homepage was still rendering
`src/lib/mock-events.ts`, so the task actually in the way of a faculty demo was
*both*: build the listing, and take the homepage off mock data.

**THE MEASUREMENT THAT DEFINED THE WORK.** A crawl of the rendered homepage,
before anything changed:

    curl -s localhost:3000/ | grep -o 'href="/[^"]*"' | sort -u
      -> 18 dead 404s, and 18 mock event pages whose seat maps
         can never be held (canHold: false, mock seat ids like
         `rc-3-front-A3` exist nowhere in Postgres)

| dead links | count | source |
|---|---|---|
| `/events` | 1 | hero CTA, every rail's "View all", `not-found` |
| `/events?category=…` | 6 | homepage chips **+ navbar mega-menu + mobile menu** |
| `/legal/*` `/help/*` `/business/*` | 10 | footer |

After: **zero.** 22 × 200 and 3 × 307 (the correct auth redirects on
`/dashboard`, `/tickets`, `/organizer`) across `/`, `/events` and every filter.

**`npm run seed-events` — a real catalogue, added without destroying one.**
The database had 3 events at 1 venue, one of them already ended: a real-data
homepage of **two** near-identical cards, both Chennai, both from Rs 999. No
layout work makes that read as a catalogue. `db:seed` would have fixed it and
deleted every order and ticket in the process, so this script only ever INSERTs
— the same posture as `fix-dates`. It added 3 venues (Mumbai, Bengaluru,
Delhi NCR) and 8 events, 4 on sale and 4 upcoming, prices now spanning
Rs 380–Rs 1,798. Every structural constant (`TIERS`, `ROWS`, `SEATS_PER_ROW`) is
copied from `seed.ts` so each new seat map is identical in shape to the one
T19–T30 were verified against, and the pre-sold seats are created through **real
orders and order_items**, never by setting `seats.status = 'sold'` alone — which
would have left T22's availability query reporting them free and T36's dashboard
reporting zero revenue. Idempotent: a second run skips all 8 by title.
`users` unchanged, 44 → 44.

**Deviations from the directive, each deliberate:**

1. **Cards do not all link to `/events/[id]/seats`.** The directive says every
   card should. An **on-sale** card does. An **upcoming** card goes to its detail
   page instead, because the seat map for an undropped event renders every seat
   as pickable and `createHold` then refuses the entire selection with
   `EVENT_NOT_ON_SALE` — a button that fails *after* the user has done the work.
   That is the same class of dead end this task exists to remove. The destination
   is derived from `state`, which the status badge also displays, so the card
   tells you where it is about to take you.

2. **Two rails, not five.** "Recommended for you" and the two "Spotlight" rails
   were category slices and `events` has no category column — keeping them meant
   inventing categories or showing the same rows four times under four headings.
   On sale / next drops is the one split the data genuinely supports.

3. **The category taxonomy was removed from the NAVBAR too,** not just the
   homepage. `CategoriesMenu` is on every page in the app, so cleaning only the
   homepage would have left six dead links everywhere else. `quick-filters.tsx`
   and `categories-menu.tsx` are deleted; `taxonomy.ts` keeps only `CITIES`
   (the location selector navigates nowhere, and the catalogue now spans four
   cities for real). The mobile menu's six category links became three real
   ones: All events / On sale now / Next drops.

4. **`/events` filters by status, and search now works.** Status is derived from
   `status` + `drop_at` + `starts_at` together — the same composite test
   `createHold` applies — so "On sale" means the hold API will actually serve it.
   And `?q=` is honoured because the navbar's search box has **always** pushed to
   `/events?q=…`; until this page existed that was a 404 as well. It searches
   title, venue and city, with `%` wrapped in the *parameter* so a user typing a
   literal `%` searches for one instead of matching everything.

5. **The footer keeps its design and loses its 404s.** Ten unbuilt destinations
   now render as dimmed, **non-focusable** text rather than anchors — same words,
   same three columns, same rhythm, nothing to 404 into, and keyboard users are
   not walked through four items that go nowhere. `href` became optional on the
   type, so giving one of them a page later is a one-line change.

**`scripts/verify-seat-sync.mjs` lost a third of its subject and was updated, not
deleted.** It asserted that the landing page, detail page and seat map agree on
each mock event's count. The homepage no longer renders mock events, so that
third would now fail *for the right reason* — the worst kind of failing test. It
is a two-page check (detail + seat map, still served by `event-lookup`'s mock
fallback) with the reason recorded in the header. Real events are covered by the
click-path crawl instead. `verify-seat-math.ts` is untouched and still passes;
`mock-data.ts` stays because the **real** seat map borrows its types and tier
colours via `src/db/queries/seats.ts`.

Also fixed in passing: `check-seed.mjs` hardcoded `count(*)/3` for "seats per
event" and reported **1056** once the catalogue reached 11 events. Now divided by
the actual event count.

**Verified end to end, not asserted:**

    homepage        10 real uuid cards, 0 mock links, 4 cities,
                    5 "On sale" + 5 "Drops in Nd" badges
    click-path      5 on-sale cards -> /seats -> 200 with 288 seat
                    buttons each, canHold: true, 162-245 available
                    5 upcoming cards -> detail -> 200
    /events         11 listed; on-sale filter -> 5; q=aurora -> 1
    dead links      0 of 25 internal links 404 (was 18)

**One thing a curl cannot see, stated rather than glossed:** the upcoming detail
pages render an empty fixed-height slot server-side, because T18's countdown is a
client component with a stable server snapshot — deliberately so, to avoid a
hydration mismatch on a ticking clock. The digits appear on hydration, in a real
browser, which I cannot drive here. (Two of the five *appeared* to show countdown
text to my grep; that was their seeded descriptions containing the words
"tickets release", not the CTA.)

**Full regression:** hold 20 / expiry 18 / release 18 / checkout 24 / webhook 50 /
success 18 / ticket 36, the T21 race test (1 winner, 49 conflicts, 0 errors),
`verify-seat-math` 14/14, the updated `verify-seat-sync` 14/14, and
`check-seed.mjs` clean across **3,168 seats and 11 events — zero oversells.**

---

### ☑ T18 🟡 — Event detail page

**Prompt:**

> Build `/events/[id]` showing event hero, description, venue info, section pricing table, and a countdown timer to `dropAt` if the event hasn't dropped yet. The countdown must be a client component. Handle the not-found case with `notFound()`.

**Verify:** the 2-minute countdown event actually ticks down.
**Commit:** `feat: event detail page`

---

## PHASE 5 — The booking engine 🔥

> This is the part that makes the project worth putting on a CV. Slow down here. Read every explanation.

### ☑ T19 🔴 — Seat map UI

**Prompt (Plan Mode):**

> Build a `SeatMap` client component for `/events/[id]/seats`. It receives seats grouped by section and row. Render as a grid: available = slate, held = amber with a slow pulse, sold = dark red and not clickable, selected = bright accent with a scale-up spring animation via Framer Motion. Include a stage indicator at the top and a legend. Clicking an available seat toggles selection (max 4 seats). Show a sticky bottom bar with selected seats and total price. No backend yet — local state only.

**Verify:** you can select and deselect seats and see the total update.
**Commit:** `feat: seat map UI`

**Done.** Two deviations from the prompt above, both deliberate:

1. **Sold seats are pure black, not dark red.** Red on this palette collides with
   nothing else on the page but does collide with the *meaning* users bring: red
   reads as "error" or "warning", not "already bought". Sold seats are the
   quietest thing in the room (`#000000`, 5% border) so attention lands on what
   is buyable. Availability is never carried by colour alone - sold and held
   seats also carry `disabled` and say their state in the accessible name.

2. **The seat data was centralised first.** The prompt says "receives seats
   grouped by section and row", which assumes a source. Building one exposed
   that the landing badge, the T18 pricing table and this map each computed
   availability independently - three numbers that could disagree, and did.
   `src/lib/mock-data.ts` is now the only place a seat count exists;
   `scripts/verify-seat-math.ts` asserts the invariants and
   `scripts/verify-seat-sync.mjs` asserts the three rendered pages agree.

**Also fixed while here:** `SeatCounter` used to invent sales on a random timer,
so a card advertising 12 seats read 9 within half a minute while the map still
held 12. It now renders the count it is given.

**Known gap for T20:** selection is local state only, as specified. Nothing is
reserved, so two people can select the same seat until the hold API exists.

---

### ☑ T20 🔴 — The hold API (the heart of the project)

**Prompt (Plan Mode — and read the explanation twice):**

> Create `POST /api/holds`. Behaviour:
> 1. Require an authenticated user
> 2. Validate the body `{ seatIds: string[] }` with Zod, max 4 seats
> 3. Inside a **single database transaction**: `SELECT ... FOR UPDATE` on all requested seats ordered by seat id (to prevent deadlocks), reject with 409 if any seat is sold or has a live unexpired hold, insert hold rows with `expiresAt = now() + 10 minutes`, and update those seats to status 'held'
> 4. Return the holds with their expiry timestamps
>
> Handle the unique-index violation on `one_live_hold_per_seat` gracefully as a 409.
>
> Then explain to me: what a transaction is, what `FOR UPDATE` does, what a race condition is, and why ordering the seat ids prevents deadlock.

**Done.** `src/db/queries/holds.ts` holds the transaction; `src/app/api/holds/route.ts`
is the endpoint. Verified by `scripts/hold-test.ts`, which imports the real
`createHold` rather than re-implementing it (20 checks, including six different
users racing one seat: exactly one winner).

Three deviations from the prompt, each one a defect the literal spec would ship:

1. **Availability is read from the source of truth, never `seats.status`.** An
   expired hold leaves `status='held'` behind, so checking the cache would make
   every expired seat permanently unsellable. The decision reads `order_items`
   and live unexpired holds; `seats.status` is still written as the render cache
   but never read.

2. **Expired holds are released inside the transaction, before the insert.**
   `one_live_hold_per_seat` is unique on `seat_id WHERE released_at IS NULL`, and
   an expired hold still has `released_at IS NULL` — so without this the insert
   dies on a 23505 for a seat every availability query calls free. Proven by
   deleting the step and re-running: the expiry test fails exactly as predicted.

3. **The SQL `ORDER BY s.id` is what orders the locks, not the JS sort.**
   `EXPLAIN` shows `LockRows` above the index scan, so lock order is the scan's
   emission order. The JS sort is kept for de-duplication.

Also stricter than asked: the 4-seat cap counts a user's live holds **per event**,
not per request, and the endpoint refuses events that have not dropped — both
close scalping holes a per-request cap leaves open. A retry that finds the
caller's own holds returns 200, not 409.

**Not yet verified by me:** the signed-in browser path (button → 200 → countdown).
It needs a real login, which I do not perform. The 401 branch is verified: the
button POSTs real seat uuids and lands on `/login?next=…`.

**Verify:** hold a seat via the UI, check the `holds` table in Supabase.
**Commit:** `feat: seat hold API with row locking`

---

### ☑ T21 🔴 — Prove it works under contention

**Prompt:**

> Write a script `scripts/race-test.ts` that fires 20 simultaneous requests for the SAME seat id and reports how many succeeded. Exactly one must succeed. Run it and show me the output.

**Verify:** output says 1 success, 19 conflicts.
**Commit:** `test: concurrent hold race test`

> 📸 **Screenshot this output.** It goes in your README and your presentation.

**Done — scaled to 50 users, not 20.** `npm run race-test`.

    Successes (Winners) :  1     Conflicts (Losers) : 49     Server Errors : 0
    peak concurrent transactions   50 of 50
    all 50 fired within            0.9 ms
    total wall time                10493 ms   (p50 5617 ms / max 10492 ms)
    DB VERIFICATION: 1 LIVE HOLD VERIFIED. ZERO OVERSELLS.

Three corrections to the brief, each one the difference between proof and theatre:

1. **Fifty invented uuids would prove nothing.** `holds.user_id` is a foreign key to
   `public.users`, so fabricated ids fail with 23503 — the run would read 0 winners /
   0 conflicts / 50 errors, which looks like a broken lock. The script creates fifty
   real users and deletes them. Safe: `public.users` has no FK to `auth.users`, and
   the delete-sync trigger runs auth → public only.
2. **A pool of 5 makes "50 simultaneous" false.** Forty-five calls would never reach
   the database until the winner had committed, so they would "lose" by reading an
   already-taken seat rather than by contending. `DB_POOL_MAX` (added to
   `src/db/index.ts`, default unchanged) lets all fifty open at once — measured and
   reported as **50 of 50**, not assumed.
3. **The target seat is chosen by the source of truth**, not `status = 'available'`.
   The cache lags, and a stale 'held' would hand the test a taken seat and report a
   false failure.

**NEGATIVE CONTROL — the run that makes the green run mean something.** With
`.for("update")` removed and nothing else changed:

    Successes: 1   Conflicts: 34   Server Errors: 15   →  FAILED, exit 1

The fifteen errors are unique-violations on `one_live_hold_per_seat`: without the row
lock, fifteen transactions passed the availability check simultaneously and collided at
the insert. **Still exactly one live hold** — layer 2 held the line when layer 1 was
removed, which is the defence-in-depth the schema was designed around. Note also the
wall time: 1.5s unlocked versus 10.5s locked. The lock buys correctness and clean
"seat taken" messages, and pays for it in queueing.

---

### ☑ T22 🟡 — Lazy expiry

**Prompt:**

> Change every seat availability query so that a seat with status 'held' whose live hold has `expiresAt < now()` is treated as available. Do this in SQL, not in JavaScript. Explain why handling expiry lazily in the query is more reliable than depending on a scheduled cron job.

**Commit:** `feat: lazy hold expiry`

**Done.** `npm run expiry-test` — 18 checks.

**Audit first: the read path was already correct.** T20 established `seats.status` as a
render cache, and every availability query already read the source of truth. No production
query decided availability from the cache. So T22 became *make it impossible to get wrong
twice*, and prove it.

**One definition.** The predicate was spelled out by hand in nine places. It now lives once
in `src/db/queries/availability.ts` as composable SQL fragments — `seatIsSold`,
`holdIsLive`, `seatHasLiveHold`, `liveHoldOwner`, `seatIsAvailable`, `seatStatusExpr`.
Adding a future state is one edit, not nine that must land together.

**A real bug the audit found.** `getSeatMapForEvent` ran two queries: the per-seat `case`
gave sold precedence over held, but the sibling tier aggregate counted held *without*
excluding sold. A sold seat carrying an unreleased hold would be counted in both, so
`available + held + sold` could exceed the seats in the room. Unreachable today; reachable
the moment T27 creates `order_items`. Fixed by collapsing to one query and reducing the
tier counts in JS from the seat rows — the counts *are* the seat list, so disagreement is
now unrepresentable. Also one round trip instead of two (~50 ms per render; network
dominates the ~1 ms query by 50×).

**Correction to the brief.** It specified `seats.status === 'held' AND expires_at > NOW()`.
Requiring the cache as a conjunct re-introduces the bug T20 removed: if the cache drifts to
'available' while a live hold exists, the map offers a seat the API refuses. Only the source
of truth is consulted.

**Step 2 (write path): already correct from T20, no change.** `hold-test.ts` test 5 proves
user B takes seats whose hold belongs to user A once A's `expires_at` has passed; deleting
the release step makes it fail with 23505. A comment in `createHold` records this.

**Step 3 (frontend): verified against the running app**, not asserted. With an expired,
unreleased hold in place and `seats.status` still reading `'held'`:

    BEFORE     available=231 held=0    Front, row H, seat 4, ₹4,999, available
    LIVE HOLD  available=230 held=1    Front, row H, seat 4, ₹4,999, on hold, unavailable
    EXPIRED    available=231 held=0    Front, row H, seat 4, ₹4,999, available
               DB: seats.status='held', unreleased hold rows=1

**No schema change.** `EXPLAIN` showed the existing `one_live_hold_per_seat` partial index
already serves the predicate, so nothing was added to the locked schema.

---

### ☑ T23 🟡 — Upstash Redis + rate limiting

Create an Upstash Redis database, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into `.env.local`.

**Prompt:**

> Install `@upstash/redis` and `@upstash/ratelimit`. Create `src/lib/redis.ts`. Add a sliding-window rate limit of 10 requests per 10 seconds per user on `/api/holds`, returning 429 with a `Retry-After` header when exceeded. Also mirror each hold into Redis as `hold:{seatId}` with a 600-second TTL. Explain what Redis is and why we use it alongside Postgres rather than instead of it.

**Verify:** spam the button — you get a 429.
**Commit:** `feat: redis rate limiting and hold cache`

**Done.** `npm run ratelimit-test` — 10 checks. The curl probe:

    401 401 401 401 401 429 429 429

Five pass the limiter and fail auth; the sixth is bounced **before any Postgres
connection opens**. That boundary is the evidence the limiter sits above the database
work, and it needs no login to demonstrate.

**FINALIZED — running on live Upstash.** Credentials are populated and verified; the
limiter is on the edge network, not the in-memory fallback.

*Proof it is really Redis, not a per-process counter:*

    npm run ratelimit-shared
    pid 27472 spends all 5 requests -> dev server (different pid) refuses the 6th with 429

A `Map` is not shared between OS processes. The dev server could only refuse that request
by reading a counter the script process wrote outside both of them. Latency alone would
have been weak evidence; this is not. Corroborated by the key appearing in Upstash
(`rush:ratelimit:holds:ip:<addr>:<window>`, type string, ttl 4s) and by measured latency
of 104–123 ms per allowed request versus ~0 ms for in-memory.

*Two hazards the finalization audit found and fixed:*

1. **`timeout` defaulted to 5000 ms.** On a slow Upstash, every request — including
   legitimate ones — would have waited five seconds and then been allowed through. During
   a drop that is worse than no limiter: the shield stops shedding load and starts adding
   it. Now `1000`, which is >4× the worst measured latency (218 ms), so it never fires
   normally and caps an outage at one second.
2. **Every refusal cost a full round trip.** A bot hammering the endpoint made the server
   pay ~92 ms each time it said no. `ephemeralCache` now remembers a blocked identifier
   locally until the reset timestamp Redis returned. Visible in the test output: the last
   two 429s land at 54 ms and 49 ms against 104–123 ms for Redis-consulting requests.

3. **Production now fails fast when unconfigured.** `redis.ts` throws at module load if
   `NODE_ENV === "production"` and either variable is missing. A forgotten env var on
   Vercel used to mean a silent per-instance counter that looked like protection. Local
   development keeps the in-memory fallback, so the repo still runs without credentials.

*Step-3 completion audit — all three already correct, no changes needed:* identifier is
the verified JWT `sub` (`route.ts:111`), the limiter runs before `getCurrentUser()`
(L134 vs L162), the 429 branch does not call `router.refresh()`, and the button disables
with the polite message announced through a live region.

Deviations, each deliberate:

1. **Identify by verified JWT subject, not IP.** `getVerifiedClaims()` yields `sub`
   without querying Postgres, so per-user limiting satisfies "edge before database".
   This matters: `x-forwarded-for` is client-written and rotatable locally, and on campus
   wifi or carrier NAT hundreds of people share one address — a per-IP limit would lock
   out a lecture hall during a drop. IP is the fallback for unauthenticated callers.
2. **5 per 10 s**, per the T23 brief, not the 10 written above.
3. **The error envelope is kept.** The brief asked for a bare string; every other failure
   on this route returns `{ error: { code, message } }` and the frontend reads
   `error.message`, so a bare string would render `undefined`. `Retry-After` and
   `RateLimit-*` headers carry the machine-readable part.
4. **The client does not `router.refresh()` on a 429** — that would fire a second request
   at the exact moment the server is shedding load. It shows the message, keeps the seat
   selection, and disables the button until `Retry-After` elapses.
5. **Fails OPEN if Redis is unreachable.** Every correctness rule lives in Postgres — the
   row lock, the partial unique index, the 4-seat cap — and none weakens without Redis. A
   component that guards against load must never be able to take ticket sales offline.

**The `hold:{seatId}` Redis mirror was deliberately NOT built.** A Redis copy of seat state
is a second source of truth that cannot join the hold transaction, so it can commit while
Postgres rolls back with no way to tell which is right. T22 was spent removing exactly that
divergence. Redis holds counters here; Postgres holds truth.

**Honest scope:** this protects the *server* from load. It does not protect *inventory*
from scalpers — residential proxies plus a pool of accounts route around any
per-identifier limit. The 4-seat cap and the row lock are what protect inventory.

**Supply chain:** `@upstash/redis` 1.38.3 and `@upstash/ratelimit` 2.0.8, both
`@upstash`-scoped and published from upstash.com addresses; installed with
`--ignore-scripts`. They add **zero** advisories. `npm audit`'s 4 moderate findings all
chain from `drizzle-kit`, a devDependency — dev-only and not reachable in production, so
tracked rather than force-fixed (which would cross drizzle-kit majors).

---

### ☑ T24 🟡 — Hold countdown UI

**Prompt:**

> When the user holds seats, show a countdown ring (SVG circle with animated stroke-dashoffset) ticking down from 10 minutes. At 60 seconds turn it red and pulse. At zero, release the hold and refresh the seat map. Add a "Release seats" button. Use optimistic UI so seats respond instantly on click.

**Commit:** `feat: hold countdown`

**Done.** `npm run countdown-test` — 10 checks.

**Reload safety is the substance of this task, and it reads from Postgres, not
localStorage.** `getActiveHoldsForUser(userId, eventId)` is called by the seats page and
seeds the timer, so a refresh resumes at the correct remaining time instead of vanishing
while the database holds the seats for another nine minutes. localStorage was rejected for
one specific reason, and the test asserts it: **an expired hold returns null while its row
still exists, unreleased** — a cached `expiresAt` cannot know the hold died, so it would
count down seats released twenty minutes ago and offer Proceed to Payment for tickets
nobody owns. `mine` is restored from the same read, so the user's seats stay gold after a
refresh rather than reverting to a stranger's amber.

**Corrections to today's brief:**

1. **The pulse is on a dot, not the digits.** Measured on the live page, `animate-pulse`
   fades its target to 50% opacity, taking the red timer from **5.57:1 to 2.04:1** — under
   even the 3:1 large-text floor — for half of every cycle, at the moment the number matters
   most. The dot carries no information, so it can blink freely. Gated on `useReducedMotion`;
   Tailwind's `animate-pulse` does not respect `prefers-reduced-motion` on its own.
2. **Kept `useSyncExternalStore`** rather than `useEffect` + `setInterval`. With an effect the
   first render — server *and* hydration — computes `expiresAt - Date.now()`, and those
   clocks never agree: a hydration mismatch on the one number the user is trusting.
3. **`text-destructive`, not `text-red-500`.** Both pass (5.57 vs 5.58:1 on black), so this is
   consistency with the project's own semantic token, not a compliance fix.

**Divergence from the prompt written above, which today's brief superseded:**

- **No SVG countdown ring.** The brief specified a text timer with a 120-second urgency
  threshold; the ring and its 60-second threshold were not requested. The ring is additive
  and can be layered on later without touching the engine.
- **No "Release seats" button.** It cannot exist yet — there is no release endpoint. That is
  **T25**, immediately below, and the button belongs with it.
- **Optimistic UI applies to selection only, deliberately.** Clicking a seat is instant
  because it is local state. The *hold* is never optimistic: showing seats as secured before
  Postgres has taken the row lock is exactly the lie T20 exists to prevent.

The payment CTA reads **"Proceed to Payment →"** as specified but stays disabled with a
visible "Checkout opens in T25" note beneath it — a demo whose most urgent button silently
does nothing is worse than one that says why.

**Testing the timer without waiting ten minutes:** `npm run expire-hold -- 130` crosses the
urgency line, `npm run expire-hold -- 5` reaches zero. Both rewrite `expires_at` on your live
hold and print what the page would read back.

---

### ☑ T25 🟢 — Release endpoint + cleanup cron

**Prompt:**

> Create `POST /api/holds/release` that sets `releasedAt` and returns seats to 'available', verifying the hold belongs to the requesting user. Also create `GET /api/cron/cleanup` that permanently releases expired holds, protected by a `CRON_SECRET` bearer token. Add `vercel.json` with a daily cron at 03:00 UTC hitting that route. Note that Vercel's Hobby plan limits cron frequency, which is fine because our expiry is already lazy — this is just housekeeping.

**Commit:** `feat: hold release and cleanup cron`

**Done.** `npm run release-test` — 18 checks.

**Zero-sabotage is enforced in SQL, not JavaScript.** `user_id = $me` sits inside the
UPDATE's WHERE clause, so a row belonging to someone else simply does not match. There is
no ownership branch in the route handler to forget, no read-then-write gap, and no way for
a later edit to bypass it. The adversarial test is the one that matters: Bob names Alice's
three seats, releases **nothing**, and her holds are untouched.

**A real auth hole in the brief, closed.** The specified check was
`` `Bearer ${process.env.CRON_SECRET}` ``. When that variable is unset the template
collapses to the literal string `"Bearer undefined"` — and anyone sending exactly that
header authenticates. The route now returns 401 unconditionally when the secret is absent
and compares with `timingSafeEqual`. Proven by deleting `CRON_SECRET` and re-importing the
route: no header, `Bearer undefined` and `Bearer ` are all rejected.

**Release also repairs `seats.status`.** `createHold` writes `'held'`, so touching only the
`holds` table would leave the cache permanently wrong. Guarded by `seatIsSold` so a sold
seat can never be flipped back.

**Idempotent:** releasing already-released seats returns `200 { released: 0 }`, not 404 — a
retry after a dropped connection must not report failure for something that succeeded.

**Separate rate-limit bucket** (10 per 10 s, `rush:ratelimit:release`). Sharing the hold
budget would lock someone who just burned five attempts *out of giving seats back* — the one
action that returns inventory to everyone else. Verified: after `/api/holds` returns
`429 429`, `/api/holds/release` still answers `401` on the same identifier.

**The cron stays cosmetic, and the test asserts it.** Before cleanup runs, expired seats are
*already* available — that is T22. If this job ever became load-bearing, that guarantee
would have quietly become a lie.

**UI:** a secondary "Release seats" button beside the payment CTA, with a two-step inline
confirm ("Tap again to release", self-disarming after 4 s). No modal over a running
countdown, and a stray click next to Proceed to Payment cannot cost someone their seats.

**No amber flash.** After a release the `seats` prop still says `'held'` until
`router.refresh()` lands, so the user's own seats would have painted amber and pulsing —
"on hold, unavailable" — as though a stranger took them. A short-lived `justReleased` set
overrides them to available, applied **only after a 200**, and cleared the moment fresh
props arrive.

---

## PHASE 6 — Payments

### ☑ T26 🟡 — Stripe setup

Get your test-mode keys from the Stripe dashboard. Add to `.env.local`:
```
STRIPE_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

**Prompt:**

> Install the stripe SDK. Create `src/lib/stripe.ts`. Explain what a Checkout Session is and why we never handle card details ourselves.

**Commit:** `chore: stripe client`

**Done.** `src/lib/stripe.ts` wraps the client behind the same loud `required()`
convention `src/lib/supabase/env.ts` already uses - throw with a clear message
at import time, never a silent `undefined`. `apiVersion` is pinned to the exact
string the installed SDK (23.0.0) defaults to, confirmed by reading
`node_modules/stripe/cjs/apiVersion.js` directly rather than from memory, so a
future `npm update` that bumps the SDK can't silently change the wire format
this code was read and written against.

---

### ☑ T27 🔴 — Checkout session

**Prompt (Plan Mode):**

> Create `POST /api/checkout`. It must: verify the user holds all requested seats and the holds haven't expired, create an `orders` row with status 'pending' plus `orderItems`, create a Stripe Checkout Session in INR with a line item per seat and `metadata.orderId`, set success and cancel URLs, and return the session URL. Wrap the order creation in a transaction.

**Verify:** clicking Pay takes you to a Stripe checkout page.
**Commit:** `feat: stripe checkout session`

**Done.** `src/db/queries/orders.ts` holds the transaction (`createPendingOrder`);
`src/app/api/checkout/route.ts` is the endpoint; `src/lib/checkout-session.ts`
builds the real Stripe call so the route and the test import the identical
function. `npm run checkout-test` — 24 checks against the real Postgres
database and the real Stripe test API (not re-implementations), plus one HTTP
pass at the live rate limit.

Two deviations from the prompt, each one a defect the literal spec would ship -
the same pattern T20, T22, T23 and T25 each found in their own briefs:

1. **`orderItems` is never written here - only by the webhook, in T28.**
   `order_items` carries `one_sold_seat`, an UNCONDITIONAL unique index on
   `seat_id` - unlike `holds`, which is only unique while `released_at IS
   NULL`. Insert a row the moment a 'pending' order exists, and if that Stripe
   session is ever abandoned, expires, or fails, the seat can never be
   inserted into `order_items` again, by anyone, ever - `seatIsSold()` has no
   idea the parent order never got paid. One abandoned checkout would
   permanently remove a seat from inventory. `createPendingOrder` writes only
   the `orders` row; the webhook writes `order_items` at the one instant that
   actually earns the word "sold" - a confirmed `checkout.session.completed`.
   (This also settles an ambiguity in T28's own brief below, which never
   mentions inserting `order_items` either - it has to happen there, by
   construction, or `one_sold_seat` never does anything.)
   Proven by test 6/8: a pending order, and a second one against the same
   still-held seats, both land zero rows in `order_items`.

2. **The caller's holds are extended to match Stripe's own expiry floor.**
   `Checkout.Session.expires_at` must be 30 minutes to 24 hours from creation -
   confirmed directly against the installed SDK's type comment
   (`node_modules/stripe/cjs/resources/Checkout/Sessions.d.ts`), not memory,
   since training data is exactly what `AGENTS.md` warns not to trust here.
   The hold lives ten. Left alone, a hold can lazily free (correctly, by
   T22's own rules) while its buyer is still sitting on an open Stripe page;
   a second buyer can then legitimately pay for the same seat, and when the
   first buyer also finishes paying, one of the two webhooks loses to
   `one_sold_seat` with real money already moved. `createPendingOrder`
   extends the live holds to the exact instant (`CHECKOUT_WINDOW_MINUTES` =
   30, +60s buffer) the Stripe session will expire, inside the same
   row-locked transaction that verifies them - an UPDATE of a row the caller
   already owns, so `one_live_hold_per_seat` (which only guards a second
   INSERT) is not in play. Proven by test 6: the hold's `expires_at` in
   Postgres and the real Stripe session's `expires_at` land on the same
   second.

Also stricter than asked: Stripe's own `amount_total` on the created session
is checked against the server-computed total (test 7), not just our local
variable - proof the price reaches Stripe itself, not only our own response.
`metadata.seatIds` is stored alongside `metadata.orderId` so the future
webhook has a durable, signature-verified source for "which seats" that does
not depend on whether the holds are still live by the time it reads them back.

**A Stripe API change caught by the type-check, not assumed from training
data:** `payment_method_types` no longer exists on `SessionCreateParams` in
the pinned API version (`2026-09-30.endive`) - `tsc` refused the first draft.
Stripe now manages enabled methods per-account from the Dashboard; "card" is
on by default, which is also what the brief's test card exercises, so the
field is simply omitted rather than guessed at.

**Known, stated gap, same pattern as T24/T25's forward references:**
`success_url` points at `/orders/[id]/success`, which doesn't exist until
T29. A real payment will 404 after completing until then. The hold-banner's
"Checkout opens in T25" placeholder is gone - the button either works or
shows why it didn't.

**Not yet verified by me: the fully authenticated browser path (click Pay,
land on Stripe, pay with 4242 4242 4242 4242, return).** Same limitation T20
already disclosed - it needs a real login, and the seeded demo buyers have no
Supabase Auth password, only a `public.users` row. A plain HTTP fetch of the
seats page confirms it still renders (200, correct title, no error markup) as
a regression check, and `checkout-test.ts`'s test 7 calls the real
`buildCheckoutSession` against the real Stripe test API and gets back a real
`cs_...` session whose `url` genuinely starts with
`https://checkout.stripe.com/` - but nobody has clicked it in a browser.

---

### ☑ T28 🔴 — The webhook (this is the interview question)

**Prompt (Plan Mode):**

> Create `POST /api/webhooks/stripe` handling `checkout.session.completed` and `checkout.session.expired`. It must:
> 1. Read the raw body and verify the Stripe signature — reject with 400 if invalid
> 2. Check `webhookEvents` for the `stripeEventId`; if present, return 200 immediately without reprocessing
> 3. In one transaction: insert the webhookEvent row, mark the order 'paid', mark seats 'sold', set `releasedAt` on the holds, and create ticket rows
> 4. On expiry, release the holds instead
>
> Then explain: why Stripe retries webhooks, what idempotency means, and what would go wrong without the `webhookEvents` table.

Test locally with the Stripe CLI:
```powershell
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Use test card `4242 4242 4242 4242`, any future expiry, any CVC.

**Verify:** after paying, the order is 'paid', seats are 'sold', tickets exist.
**Commit:** `feat: idempotent stripe webhook`

**Done.** `src/db/queries/webhooks.ts` holds both transactions;
`src/app/api/webhooks/stripe/route.ts` is the endpoint. `npm run webhook-test` -
**50 checks**, every one against the real route over real HTTP with payloads
signed by the real `STRIPE_WEBHOOK_SECRET` (via the SDK's own
`generateTestHeaderString`). Nothing mocked.

    8. 20 deliveries of ONE event, fired simultaneously
       20 concurrent deliveries in 1256 ms
       outcomes: {"fulfilled":1,"replayed":19}
       DB VERIFICATION: exactly two tickets for two seats. One webhook_events row.

**A REAL BUG THIS TEST FOUND, IN CODE THAT SHIPPED THREE TASKS AGO.** The first
run came back `{"fulfilled":1,"http_500":19}` - the data was perfect but every
replay answered **500**, which tells Stripe to retry a payment it had already
fulfilled, for three days. Cause: **Drizzle does not throw the driver's error.**
It throws a `DrizzleQueryError` and hangs the `PostgresError` - the object
actually carrying `code` and `constraint_name` - on `.cause`. So the idiomatic

    (error as { code?: string }).code === "23505"

typechecks, reads `undefined`, and never matches. Fixed in a new
`src/db/pg-error.ts` that walks the `cause` chain.

**The same bug was already live in `src/db/queries/holds.ts`** -
`isLiveHoldViolation` and `isDeadlock` were written the same way, so the 409 and
503 branches in `/api/holds` were unreachable dead code. **It is visible in
T21's own recorded output:** the negative control reported
`Successes: 1  Conflicts: 34  Server Errors: 15`. Those fifteen were
`one_live_hold_per_seat` firing exactly as designed - but because the code could
not be read, each one became a generic 500 "Could not hold those seats" instead
of an honest 409 "Someone just took that seat." The database was always right;
the error mapping was discarding its answer. Both now route through the shared
helper. T20/T21/T22/T25/T27 suites all still pass (20/50/18/18/24 checks).

**NEGATIVE CONTROL - four configurations, removing one layer at a time.** This
is the run that makes the green run mean something, and it found something
better than expected: **no configuration ever issued duplicate tickets.**

| removed | 20 concurrent outcomes | tickets | verdict |
|---|---|---|---|
| nothing | `fulfilled:1, replayed:19` | 2 | clean 200s |
| the `webhook_events` insert | `fulfilled:1, already_paid:19` | 2 | layer 2 held |
| + the `already_paid` guard | `fulfilled:1, seat_conflict:19` | 2 | layer 3 held |
| + the `seatIsSold` guard | `fulfilled:1, http_500:19` | 2 | `one_sold_seat` / `tickets_seat_unique` held |

Four independent layers, each sufficient on its own. What the upper layers buy
is not the data guarantee - the indexes already provide that - it is the correct
**HTTP contract** and clean order state: Stripe stops retrying, and the order is
not left marked `failed` by nineteen handlers racing behind the one that
succeeded.

Deviations from the brief, each one a hole the literal spec would ship:

1. **The brief's step 2 is a race, and step 3 fixes it by accident.** "Check
   `webhookEvents` for the `stripeEventId`; if present, return 200" is a
   `SELECT`-then-act - exactly the pattern T20 exists to refute. Stripe's
   retries overlap, so two deliveries both read "absent", both proceed, both
   issue tickets. The guarantee cannot come from the read. The `INSERT` is moved
   to the **very first statement** in the transaction, where the unique index
   makes a concurrent duplicate *block* and then fail 23505. The pre-check is
   not kept at all: it would be a second code path to maintain that provably
   decides nothing.

2. **`checkout.session.completed` DOES NOT MEAN PAID,** and the brief never
   mentions it. The event fires when the customer finishes the flow; for a
   delayed payment method that is before money moves, with `payment_status:
   'unpaid'`. Fulfilling on the event type alone is the easiest way to give away
   free tickets. `payment_status` is now the authority (test 4 proves an unpaid
   session issues nothing), and `async_payment_succeeded` / `..._failed` are
   wired because enabling UPI or a bank debit is a **dashboard toggle, not a
   code change**.

3. **The status code is the API, and 500-vs-200 is the whole ballgame.** Stripe
   retries any non-2xx for three days. So the queries encode a strict contract:
   **return** a value for anything *decided* (the transaction commits, the
   event is marked seen, route answers 200) and **throw** only for *transient*
   failure (rollback, 500, Stripe retries into a clean slate). Getting it
   backwards either silently drops a real payment or hammers the endpoint for
   three days.

4. **A missing `STRIPE_WEBHOOK_SECRET` returns 500, not 400** - the T25
   `Bearer undefined` lesson. An empty secret makes `constructEventAsync` throw,
   which *looks* safe, but answering 400 would discard a genuine event as a bad
   signature. 500 means Stripe retries once the variable is set.

5. **Three facts must agree before money is recognised:** Stripe's
   `amount_total`, `orders.totalCents`, and the live sum of `sections.priceCents`.
   Any disagreement refuses to fulfil rather than reconciling (test 5). This keeps
   `check-seed.mjs`'s "orders whose total <> sum of its items = 0" invariant true
   by construction. Explicit trade-off: an organizer editing a price mid-checkout
   becomes a manual review instead of a receipt whose lines do not add up.

6. **`seat_conflict` is not auto-refunded.** If a seat is somehow undeliverable
   after payment, the order is marked `failed` and logged as
   `REFUND_REQUIRED_SEAT_CONFLICT` with the payment intent. A refund is a second
   money movement needing its own idempotency story - if `refunds.create()`
   succeeded and the follow-up write failed, the next retry would refund again.
   Money moving as a side effect of a webhook retry is worse than the problem it
   cleans up.

7. **No rate limit on this route,** unlike every other POST in the app. Stripe's
   traffic is legitimately bursty and shedding it produces *more* traffic later
   as retries. Nothing touches the database until the HMAC verifies, so a forged
   flood costs one HMAC each.

8. **Expiry only releases *already-expired* holds belonging to that order's
   user.** Without the `expires_at <= now()` clause, a buyer who abandoned
   checkout, came back and re-held the same seats would have their **new, live**
   hold released by the old session's expiry event. And a late `expired` event
   for a **paid** order never releases anything (test 10) - out-of-order
   delivery cannot take a valid ticket away.

Also proven rather than asserted: every issued ticket's HMAC **actually
verifies** via `verifyTicket`, and a forged signature does not (test 6); a
tampered body and a payload older than the 300s tolerance are both rejected 400,
so a captured payload cannot be replayed tomorrow (test 1).

**Not verified by me: a real card payment through the Stripe CLI.** The suite
signs genuine payloads with the real secret and exercises the full route, which
is strictly more thorough on the idempotency and security paths than one manual
`4242` purchase - but `stripe listen` + a browser checkout is still the last
mile, and it needs the authenticated login this project cannot perform. The
Stripe CLI is installed (v1.50.10) and ready for it.

---

### ☑ T29 🟢 — Success page

**Prompt:**

> Build `/orders/[id]/success` showing the confirmed order with a confetti burst on mount (canvas-confetti), the seat list, total paid, and a link to view tickets. Handle the case where the webhook hasn't landed yet by polling order status every 2 seconds for up to 20 seconds with a "confirming payment" state.

**Commit:** `feat: order success page`

> 🎓 That polling detail is a real-world touch most student projects miss — payment confirmation is asynchronous.

**Done.** `src/app/(site)/orders/[id]/success/page.tsx` (server) +
`src/components/orders/success-view.tsx` (client) +
`GET /api/orders/[id]/status` for the poll. `npm run success-test` - 18 checks.

**The security boundary is the real work here, and it is a WHERE clause.** An
order id is a uuid in a URL - it gets pasted into chats, screenshots and support
tickets - and the page shows seat numbers, what was paid, and ticket ids (half of
what a QR encodes). `getOrderForUser` carries `user_id = $me` in the query
itself, so a stranger's request matches no row. There is no
`if (order.userId !== user.id)` for a later edit to delete. Same reasoning as
`releaseHolds` in T25.

Proven adversarially, which is the only way worth proving it: test 2 has a
*different signed-in buyer* ask for a real paid order id and get `null` from both
the page query and the poll query. Verified over HTTP too - signed out, the page
answers `307 -> /login?next=/orders/<id>/success` and the API answers `401` JSON
rather than a redirect, because a polling `fetch()` would follow a 307 and try to
parse a login form as JSON.

**`notFound()` for "not yours", never 403.** A 403 confirms the order exists, and
the id is the only thing in the URL. "Bad id" and "someone else's id" are
deliberately indistinguishable (test 3).

**`?session_id` is read and deliberately ignored.** Stripe puts it in
`success_url` and it is tempting to treat it as proof of payment. It is a query
parameter: browser-controlled, covered by no signature. Authorisation comes from
the session cookie plus the ownership clause; payment status comes from the
webhook. Nothing on this page decides anything from it.

**The page does NOT fulfil the order as a fallback.** A common pattern is to
retrieve the session here and fulfil it if the webhook is late. Deliberately not
done: T28's idempotency is keyed on `webhook_events.stripe_event_id`, and a
request from a browser has no event id to key on. A second writer with no shared
gate is exactly the duplicate-ticket bug the webhook exists to prevent. One
writer, one gate; this route only ever reads.

**What the poll is actually for.** Stripe redirects the buyer the instant they
pay, while the webhook travels a separate path - so the redirect usually wins and
the order is still `pending` on first render. The page therefore has to tolerate
an order with a frozen total and *zero seat lines* (test 4 asserts exactly that
state, since `order_items` is written by the webhook, per T27). It polls every 2s
for 20s, then stops with an honest "still confirming, your seats are safe" state
and a Check again button - never an infinite spinner.

**UI/UX follows the existing Obsidian & Champagne language, not a new one:**
`.glass` stub on true black, `.text-metal` heading, `btn-gold` / `btn-gold-outline`
actions, `.rule-fade` dividers, `formatPaise` for money, `tabular-nums`
everywhere a number appears, and the stub's top edge carries the state as a
gradient hairline the way the T24 hold banner's border does.

**Motion, with the project's accessibility discipline:**
- the tick is **drawn** via SVG `pathLength` 0 -> 1 rather than fading in a
  finished glyph - a mark being drawn reads as something that just completed.
  `pathLength` normalises the path to 0..1, so the animation needs no
  hand-computed `stroke-dasharray`.
- a one-shot radial halo scales out behind the crest on arrival
- seat lines stagger in at 70ms intervals, so they read as tickets being issued
  one at a time rather than a block appearing
- confetti in the **brand palette** (champagne -> amber), two offset origins
  rather than one centred blast - a single origin reads as a graphic, two read
  as a room
- **every one of those is gated on `useReducedMotion`**, and the confetti is
  additionally `disableForReducedMotion: true` *and* lazily imported inside the
  handler, so a visitor who asked their OS for less motion never downloads the
  ~7kB library at all

**`cache: "no-store"` on the poll is load-bearing.** Without it the browser is
free to serve the first response to every subsequent poll, and the page would sit
on "confirming" forever while the order had long since been paid.

**One lint finding worth recording, because it is the third time in this
project.** The first draft set the `timeout` state from inside the poll effect
and `react-hooks/set-state-in-effect` refused it. It is now **derived** -
`attempts >= POLL_LIMIT` *is* the timeout - so there is no second copy of that
fact to drift and no cascading render.

**Not verified by me: the page rendered in a signed-in browser.** Same
limitation stated at T20, T27 and T28 - it needs a real login, and the seeded
buyers have a `public.users` row but no Supabase Auth password. What *is*
verified: both auth layers over real HTTP, the ownership rule against a real
stranger, the paid and pending data shapes, every design token resolved against
`globals.css`, and a clean `next build` registering both routes.

**Phase 6 is complete.** T26-T29 all ticked. Full regression after this task:
hold 20 / expiry 18 / release 18 / checkout 24 / webhook 50 / success 18, race
test 1 winner + 49 conflicts + 0 errors, and `check-seed.mjs` reports zero
oversells with seed data fully consistent.

---

## PHASE 7 — Tickets & gate check-in

### ☑ T30 🔴 — Signed QR tickets

**Prompt:**

> Add `QR_SIGNING_SECRET` to env. When tickets are created, set `qrSignature` to an HMAC-SHA256 of `{ticketId}.{orderId}.{seatId}` using that secret. Build `/tickets` listing the user's tickets as animated 3D-tilt cards, each rendering a QR code (use the `qrcode` package) encoding `{ticketId}:{signature}`. Explain why we sign the QR instead of just encoding the ticket id.

**Commit:** `feat: signed QR tickets`

**Done.** `src/lib/ticket-crypto.ts` is the codec, `src/db/queries/tickets.ts`
the query, `src/app/(site)/tickets/page.tsx` the page, and
`src/components/tickets/ticket-card.tsx` the stub. `npm run ticket-test` -
**36 checks**.

**The brief for this task arrived specifying `TICKET_SIGNING_SECRET` and a
`{o: orderId, s: seatId, sig}` payload. Both were refused, and the reason is
not style.** `src/lib/qr.ts` has signed every ticket since T28 as
HMAC-SHA256(`ticketId.orderId.seatId`) keyed on `QR_SIGNING_SECRET`, and **345
rows already carry those signatures** (written by the webhook and `seed.ts`,
all 64 hex chars). A `sig` covering `(orderId, seatId)` is a *different
preimage*, so it would match not one stored signature: every ticket ever issued
would fail at the T31 gate, and `tickets.qr_signature` would stop describing
what the QR contains. A second secret name would be a second value to keep in
sync on Vercel, where a mismatch fails silently and only at the door.

So the existing scheme is reused and `ticket-crypto.ts` **truncates** the
existing signature rather than computing a new one. Test section 4 is the proof:
50 sampled pre-T30 tickets each encode to a payload whose tag *is* the first 16
bytes of their stored `qr_signature`. Nothing was re-signed, nothing migrated.

**THE PAYLOAD - 33 bytes, 44 characters, fixed-width, no JSON:**

    byte 0      bytes 1..16       bytes 17..32
    [ ver=1 ] [ ticketId 16B ] [ tag 16B ]      -> base64url -> 44 chars

    AZsaPP9PlEjcmtZY8ShvoQlCGF4f9XLF7dKbsa5QO-7h

`orderId` and `seatId` are deliberately **absent**: the verifier loads the
ticket row by `ticketId` and reads both off it, so putting them in the QR costs
32 bytes to transmit data the server already holds. The tempting counter-
argument is offline verification, and it does not survive contact with T31 -
refusing a *second* scan requires shared state (`tickets.checked_in_at`), so a
database round trip happens regardless of what the QR carries.

**MEASURED, NOT ESTIMATED - and my own plan's number was wrong.** The plan
predicted Version 3 (29x29). Rendering it says **Version 4, 33x33**: I had put
QR's level-*L* capacity (53 bytes) in the level-*M* column, and v3-M actually
holds 42, one short of this 44-character payload. Measuring it also found a free
upgrade - **v4-Q holds 46 bytes, so error-correction level Q lands on the
identical 33x33 grid with 25% recovery instead of 15%.** Taken, since glare on a
glossy phone screen and moire against a webcam sensor is exactly the damage that
redundancy absorbs.

| payload | chars | version | modules |
|---|---|---|---|
| **this format, level Q** | **44** | **4** | **33 x 33** |
| naive `uuid:hex-signature` | 101 | 6 | 41 x 41 |
| the brief's literal `{o,s,sig}` JSON | 118 | 7 | 45 x 45 |

**Truncating the tag to 128 bits is safe and buys something.** Forging requires
2^128 candidates, each checkable only online against our server. And the browser
is handed **half** the signature - the full 256-bit `qr_signature` never leaves
Postgres (test section 7).

**Forgery is refused five ways, each tested rather than asserted** (section 2):
a single flipped character in the tag; ticket A's tag presented as ticket B;
the correct tag with a swapped `seatId` (the "upgrade myself to the front row"
attack); a hand-built payload with a zeroed tag; and the whole thing under a
different secret, which must fail and then verify again once restored - proof
the key is load-bearing and not decoration.

**Malformed scans are rejected before any query runs** (11 cases: empty, short,
long, `=` padded, illegal character, a bare uuid, the raw stored signature, a
number, null, an object, and a well-formed payload carrying `ver=2`).
`Buffer.from(s,"base64url")` is *lenient* - it silently skips characters it does
not recognise - so a regex gate comes first, then a length assert, then the
version byte. An endpoint that queries first and validates second is one where
anyone with a camera can make it do work.

**Authorisation, two layers, same shape as T29.** `/tickets` was already in
`src/proxy.ts`'s RULES from T15, so layer 1 was wired; `getTicketsForUser`
carries **both** `orders.user_id = $me` *and* `orders.status = 'paid'` in its
WHERE clause, which is the layer that decides. Tested adversarially: a different
buyer never sees the ticket, and a *pending* order yields none.

**Hardening fixed while here: `src/lib/qr.ts` had no `import "server-only"`.**
It reads `QR_SIGNING_SECRET` and imports `node:crypto`, and nothing stopped a
client component importing it. Next would have failed somewhere downstream with
a confusing message about a missing Node builtin; it now fails at build, naming
the problem. The secret that makes every ticket unforgeable is the wrong thing
to leave one careless import from a browser bundle.

**UI.** Obsidian & Champagne throughout - `.glass`, `.rule-fade`, `.text-metal`,
`formatPaise`, `tabular-nums` - laid out as a real stub with a dashed
perforation and two punched notches filled with the page ground. **The QR sits on
a stark white tile with a 2-module quiet zone, and that is functional, not a
style lapse:** a scanner locates a symbol by thresholding light against dark, so
champagne-on-black would invert the relationship the format assumes and decode
slowly on a good camera, not at all on a cheap one. It is the one place the dark
theme is deliberately broken and the code says so.

**Motion.** A pointer-tracked 3D tilt (`perspective` + `rotateX/rotateY` through
`useMotionValue` -> `useSpring`, so the card follows the cursor with weight
rather than snapping), capped at a shallow 7 degrees because a steeply skewed QR
is harder to scan; entrance staggered 90ms per card on T29's easing curve; spent
tickets desaturate with the QR dimmed and a "Checked in" stamp, which is what
will make T31's demo legible. Driven by `onPointerMove` and gated on
`event.pointerType !== "mouse"`, so a touch device never gets a tilt stuck where
the finger lifted - and all of it gated on `useReducedMotion`.

**`qrcode.react` 4.2.0, not PLAN.md's `qrcode`.** Dependency surface, checked
against the registry: `qrcode.react` has **zero** runtime dependencies;
`react-qr-code` pulls `prop-types` + `qrcode-generator`; `qrcode` pulls `pngjs`,
`dijkstrajs` and **`yargs`** - a command-line argument parser - into a web
bundle. Installed `--ignore-scripts` per the T23 precedent, and it adds **zero**
new advisories. (`npm audit`'s existing findings all pre-date this and chain
from `shadcn`, `drizzle-kit` and `next` - T45's territory, tracked not touched.)

**Verified by rendering, not assumed:** the card renders server-side without
throwing, emits a 33x33 QR with a white ground and black modules, carries an
accessible title naming the seat, and **does not contain the signing secret**. A
differential check confirms the geometry is genuinely driven by the value -
identical for the same payload, different when one character flips. Worth
knowing: the payload string never appears as text in the DOM at all, only as
3,691 characters of path geometry.

**T29's placeholder is closed.** "Scannable QR tickets arrive in the next build
step" is now a real link, and the success page's primary CTA points at
`/tickets` once the order is paid (still `/dashboard` while pending - a CTA
leading somewhere empty is worse than a modest one leading somewhere real).

**HOW TO VIEW A TICKET LOCALLY.**

*The real path, which also closes the authenticated-browser gap flagged since T20:*

    stripe listen --forward-to localhost:3000/api/webhooks/stripe

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` if it differs, sign
in, hold seats, Proceed to Payment, pay with `4242 4242 4242 4242` (any future
expiry, any CVC). The webhook issues the tickets and `/tickets` shows them.

*The five-second path:*

    npm run demo-ticket -- owner@gmail.com

Re-points one existing paid order at an account you can actually sign in as, and
prints the command to put it back. Dev-only (refuses when `NODE_ENV=production`),
and it touches only `orders.user_id` - `order_items` and `tickets` follow by
foreign key and every signature stays valid, because the signature covers
ticket/order/seat ids and none of them change.

**Still not verified by me: the page in a signed-in browser.** Same limitation
as T20/T27/T28/T29 - the seeded buyers have a `public.users` row but no Supabase
Auth password, and a fresh signup needs an email confirmation I cannot complete.
What *is* verified: the codec and every forgery path, both auth layers over real
HTTP, the ownership rule against a real second user, backward compatibility with
all pre-existing tickets, and a server-side render of the actual card.

**Out of scope, by design: T31.** `POST /api/checkin`, the camera scanner and
the VALID / ALREADY_USED / INVALID_SIGNATURE screens. `decodeTicketPayload` and
`verifyTicketPayload` ship **now**, with the encoder and fully tested, because a
codec whose two halves are written three tasks apart drifts.

---

### ☑ PRE-T31 FIX — the three blockers that stopped end-to-end testing

Not a numbered task; recorded here because it corrected a defect that shipped in
T19 and a structural gap left by skipping T17.

**Reported:** blank seat map, event dated "September 14, 2026" (past), and a
"Hold Seats" button that did nothing at all for a freshly registered user. The
brief proposed a React crash, an unhandled error and an empty array. **All three
hypotheses were wrong, and all three symptoms had one root cause.**

**ROOT CAUSE: the homepage linked 18 mock events and 0 real ones.** Measured:

    curl -s localhost:3000/ | grep -o 'href="/events/[^"]*"' | sort -u
      real DB events linked: 0      mock events linked: 18

T17 was skipped, so every rail rendered `src/lib/mock-events.ts`, whose seat ids
(`rc-3-front-A3`) exist nowhere in Postgres. `resolveSeatMap` correctly reports
`canHold: false` for those — so **there was no route through the UI to an event
anyone could buy.** Each symptom follows:

1. **"September 14, 2026"** — `mock-events.ts` hardcoded all 18 dates as literal
   September 2026 strings. Separately, all three *database* events were ~40 days
   stale (`starts_at` 08-17 / 08-27 / 09-03 against a db clock of 10-03). The
   seed itself was always fine — it uses `Date.now() + n * DAY`; the rows were
   just old.

2. **"Blank seat map" — not a crash; the server rendered 226 seat buttons.**
   176 of those 226 were *sold*, and T19 styled sold as `#000000` with a
   `rgba(255,255,255,0.05)` border on a `bg-black` floor. Measured: **1.08:1**,
   where WCAG 1.4.11 asks 3:1. The seats were all in the DOM and simply could not
   be seen — a nearly sold-out show rendering as an empty room.

3. **"Button completely unresponsive, no loading state, no error"** — exactly
   right, and it was a `disabled` attribute, not a failed request. No handler
   fires, so there is nothing to catch. Worse, the *explanation* lived inside the
   `selected.length === 0` branch, so it **vanished the moment a seat was
   picked** — leaving only a `title` tooltip, which does not exist on touch.

**Fixes**

- **`npm run fix-dates`** (new, non-destructive). `db:seed` would have fixed the
  dates but deletes all tickets, orders and events first — including the user's
  own purchases. This shifts every event by one uniform interval anchored on the
  live show, preserving each `drop_at`→`starts_at` gap and the
  live/scheduled/ended spread, and touches only the `events` table. Prints
  before/after plus the untouched counts (142 orders, 345 tickets, 44 users), and
  is naturally idempotent — a second run computes a 0-day shift.
- **Mock dates derived from `Date.now()`**, the old day-of-month becoming the
  offset so the rails keep their original spacing. This forced a real
  architectural fix: seven **client** components imported `formatPaise` from
  `mock-events`, so a relative date there would have been computed twice — once
  per clock — and straddled midnight into a hydration mismatch. `formatPaise`
  moved to **`src/lib/format.ts`**, and `mock-events.ts` is now `server-only`, so
  the compiler proves the boundary instead of a comment promising it.
- **Sold seats raised to 3.60:1** (`#121212` + 35% hairline), measured. T19's
  "quietest thing in the room" intent is intact — the hierarchy was never carried
  by luminance alone: an available seat's tier border measures **13.71:1**,
  nearly 4× brighter and a different hue. "Quiet" has to still mean visible, and
  1.08:1 was absent. The legend swatch was raised with it; a key that shows a
  different colour from the thing it describes is worse than no key.
- **A sold-out / "nearly sold out" notice** on the seats page, derived from the
  `stats` the header already computes — so the two numbers cannot disagree.
- **The demo-listing reason is now persistent**, with `role="status"`, and points
  at "Live now". Every outcome on that button now says something.
- **"Live now" rail** on the homepage (`getLiveEvents()`), reading real Postgres
  rows through the same `EventCard`. `EventCard`'s prop type was widened from
  `MockEvent` to an exported `EventCardData`, because typing it as the mock
  catalogue had made the mock data the *definition* of a renderable event.
- **`error.tsx` for the seats segment** — there were zero error boundaries in the
  app. Not the fix for the reported blank map, but its absence is what made that
  symptom undiagnosable from outside.

**A bug I introduced and caught, worth recording because the project already
documents the trap:** `getLiveEvents` typed a raw-`execute` column as `Date`.
`db.execute()` bypasses Drizzle's column mapping, so a `timestamptz` arrives as a
**string** — `row.starts_at.toISOString is not a function`, thrown at runtime
after a clean typecheck. The identical footgun is called out in
`db/queries/holds.ts` step 8. It also failed in precisely the way this whole task
was about: the rail silently did not render.

**Regression:** hold 20 / expiry 18 / release 18 / checkout 24 / webhook 50 /
success 18 / ticket 36, the T21 race test (1 winner, 49 conflicts, 0 errors, zero
oversells), `verify-seat-math` (14 events, all invariants hold), and
`check-seed.mjs` fully consistent.

---

### ☑ T31 🔴 — Gate scanner

**Prompt:**

> Build `/scan` (staff-only). Use a camera QR scanner library to read codes. On scan, POST to `/api/checkin` which: verifies the HMAC signature, loads the ticket, and in a transaction sets `checkedInAt` only if it is currently null. Return one of three outcomes: VALID, ALREADY_USED (with the original check-in time), or INVALID_SIGNATURE. Show a full-screen green / amber / red animated result with the seat details, auto-resetting after 3 seconds.

**Verify:** scanning the same ticket twice gives VALID then ALREADY_USED.
**Commit:** `feat: gate check-in scanner`

**Done.** `src/db/queries/checkin.ts` holds the decision,
`src/app/api/scan/route.ts` is the endpoint,
`src/components/scan/gate-scanner.tsx` is the bouncer UI.
`npm run scan-test` — **31 checks**.

**THE WHOLE TASK IS ONE SQL STATEMENT.** The camera is the visible part and the
easy part. What actually decides whether two people get into one seat is this:

    update tickets set checked_in_at = now()
     where id = $1 and checked_in_at is null
     returning checked_in_at

A compare-and-set. There is no read to race against. A concurrent identical
statement blocks on the row lock, re-evaluates its own WHERE against the
committed value once the lock releases, matches nothing, and returns zero rows.
**Exactly one caller can ever get a row back**, so "zero rows" *means*
already-scanned rather than merely suggesting it. The `row.checkedInAt` fetched
a few milliseconds earlier is deliberately never consulted for the decision —
only for the display and the signature check.

    5. 20 simultaneous scans of ONE unscanned ticket
       20 concurrent scans in 952 ms
       outcomes: {"valid":1,"already_scanned":19}
       DB VERIFICATION: exactly one checked_in_at, non-null

**NEGATIVE CONTROL — and it is worse than "the test fails".** Swapping the
compare-and-set for the textbook read-then-write and changing nothing else:

    outcomes: {"valid":20}
    FAIL  EXACTLY ONE said valid — 20 admitted — 19 people walked in free

**Twenty green screens for one ticket.** But look at the line underneath it:

    PASS  DB VERIFICATION: exactly one checked_in_at, non-null

`checked_in_at` is a single column, so the last writer wins and the table ends up
holding **exactly one** plausible timestamp. The database looks perfect
afterwards. Nineteen people got in free and the audit trail shows a single,
ordinary check-in — there is no row anywhere that records the loss. That is what
makes this class of bug worth a whole task: it does not leave evidence.

Deviations from the brief, each deliberate:

1. **`/api/scan` is authenticated. The brief offered "or keep it accessible for
   the demo" and that was declined.** This route WRITES `checked_in_at`. An open
   version lets anyone who can reach the URL **burn** tickets — not steal a seat,
   but mark a paying customer's ticket used so they are refused at the door with
   no way to prove otherwise. Denial of entry is a worse outcome than most of
   what this codebase defends against, and preventing it is one role check.
   Authorisation is **three** layers: the proxy matcher (since T15), `requireRole`
   on the page, and the role check in the route — the third is not redundant,
   because a page guard does not protect an endpoint anyone can curl.

2. **Seven UI states, not three.** The two extra ones are correctness:
   - **COULD NOT VERIFY, in amber, never red.** A 500, a 401 mid-shift, a 429 or
     a dropped connection is *not* a verdict on the ticket. Painting a network
     blip as INVALID turns away a legitimate holder, which is the one mistake a
     door cannot make. The copy says so explicitly: "nothing was checked in".
   - **camera unavailable** promotes the manual field to primary rather than
     rendering an error page, so a presenter with no webcam is never stuck.

3. **Auto-advance on a PASS only.** PLAN.md asked for a 3s auto-reset and the
   brief asked for a "Tap to scan next" button; both are honoured, but the
   asymmetry is the point. A green screen clears itself so a queue keeps moving.
   ALREADY SCANNED and SECURITY REJECT stay until a human dismisses them, because
   somebody has to read the original scan time and decide what to do about the
   person in front of them. Auto-clearing the one screen that needs a decision
   would be the wrong kind of helpful.

4. **A forged ticket and an unknown ticket are indistinguishable in the
   response.** Both are `400 { status: "forged" }`. Returning "that id exists but
   the signature is wrong" would hand a caller an oracle for enumerating real
   tickets. The *log* separates them — a well-formed payload naming a ticket id
   that is not in the table means a deleted row or a leaked secret, so it is
   logged at error while the answer on the wire stays identical.

5. **The event date is shown but does not block.** A VALID screen carries the
   show's own date so staff can spot a wrong-night ticket. It is deliberately
   informational: early arrivals and multi-day passes are real, and auto-refusing
   them would be worse than showing a human the date and letting them judge.

**Library: `@yudiel/react-qr-scanner` 2.6.0.** Four packages
(`barcode-detector` → `zxing-wasm`, plus `webrtc-adapter`), which is more than
this project usually accepts — T30 chose `qrcode.react` precisely because it had
zero. The justification: **there is no zero-dependency option that actually
works.** It uses the native `BarcodeDetector` where the browser has it (Chrome,
Edge, Android — decoding at zero byte cost) and lazy-loads the wasm decoder only
as a fallback, which is what keeps Safari and Firefox working. `html5-qrcode` is
a ~300KB imperative blob; `qr-scanner` needs a separately served worker;
hand-rolling `BarcodeDetector` would ship a camera that silently dies if the
presenter's laptop happens to be Safari. Installed `--ignore-scripts`, and it
adds **zero** new advisories.

**Two wrong turns in the rate-limit test, both recorded in the script because
each is a trap worth knowing:**

1. **Sequential requests never tripped it.** At ~250ms per round trip, thirty
   sequential requests take *longer* than the ten-second window they are meant to
   fill, so the sliding window had already forgotten the early ones. The limiter
   was right; the probe was wrong.
2. **Forty-two at once never tripped it either — for the opposite reason.** That
   many simultaneous Upstash round trips exceeded the deliberate `timeout: 1000`
   in `redis.ts`, so the limiter **failed open** and allowed everything. That is
   correct, documented behaviour (a rate limiter must never be able to take
   ticket sales offline), but a test that cannot tell it apart from a broken
   limiter is a test that lies. Now staggered ~40ms apart, and the outcome is
   reported either way so a future fail-open is visible rather than silent.

Also: the assertion carries a documented **+2 tolerance**, because
`Ratelimit.slidingWindow` is a sliding-window *counter* — two fixed buckets with
interpolation, O(1) memory — so the effective allowance is approximate near a
bucket boundary (this run let 31 through on a limit of 30). Asserting an exact
ceiling would be asserting something the algorithm never promised.

**Rate limit is 30/10s — the most generous bucket in the app**, against 5/10s on
holds. A real door scans continuously and throttling a bouncer mid-queue is
worse than the flood it nominally prevents. It is also not what makes a forged
ticket unusable; the 128-bit HMAC is. No rate limit meaningfully narrows 2^128.

**`npm run grant-role -- <email> staff` was required to make this reachable at
all**, and the reason is worth recording: `/scan` is gated to `staff |
organizer`, the seed creates exactly one non-buyer (`organizer@rush.demo`, which
has no Supabase Auth credentials), and every account a human can sign in as is a
`buyer`. So the gate was unreachable by design *and* unreachable in practice.
The script also prints the step everyone gets stuck on: **sign out and back in**,
because `public.users.role` fires migration 0004's trigger into
`auth.users.raw_app_meta_data` and *that* is what lands in the next JWT — the
token already in the cookie still says `buyer`, so the proxy keeps redirecting
to `/forbidden` until it refreshes.

**Not verified by me: a real camera reading a real screen.** The decode path
belongs to a library using the browser's native `BarcodeDetector`, and driving a
webcam needs a browser I cannot operate here. Everything behind the camera is
verified: the codec, all five forgery paths, the state machine, the 20-way race,
both auth layers over HTTP, and the limiter. The manual-entry field exists partly
so that last mile can be walked without a webcam at all.

**Regression:** hold 20 / expiry 18 / release 18 / checkout 24 / webhook 50 /
success 18 / ticket 36 / scan 31, the T21 race test (1 winner, 49 conflicts, 0
errors), and `check-seed.mjs` clean — zero oversells.

> 📸 **Film this.** Scanning a phone screen with a laptop webcam and getting a red "ALREADY USED" is the most demo-friendly thing in the project.

---

### ☐ T32 🟡 — Confirmation email

Get a Resend API key, add `RESEND_API_KEY`.

**Prompt:**

> Install resend and @react-email/components. Build a ticket confirmation email template with event details, seat list, total, and the QR as an embedded image. Send it from the webhook handler after tickets are created. Make the send failure non-fatal — log it, never fail the webhook because of it.

**Commit:** `feat: ticket confirmation email`

---

## PHASE 8 — Realtime

### ☐ T33 🔴 — Live seat updates

**Prompt (Plan Mode):**

> Enable Supabase Realtime on the `seats` table. In the SeatMap client component, subscribe to changes for the current event and update seat statuses in place with a smooth colour transition. Handle reconnection. Explain why we use a managed realtime service instead of running our own WebSocket server on Vercel — specifically that serverless functions can't hold long-lived connections and can't broadcast across instances.

**Verify:** two browser windows, same event. Hold a seat in one — it turns amber in the other within a second, with no refresh.
**Commit:** `feat: realtime seat updates`

> 📸 **This is your money shot.** Record it.

---

## PHASE 9 — Waiting room

### ☐ T34 🔴 — The drop queue

**Prompt (Plan Mode):**

> When an event's status is 'live' and it's within 10 minutes of `dropAt`, gate `/events/[id]/seats` behind a waiting room. Implementation: on entry, if the user has no Redis access token, add them to a Redis sorted set `queue:{eventId}` scored by timestamp and redirect to `/events/[id]/waiting`. The waiting page polls `/api/queue/position` every 2 seconds. A route `/api/queue/admit` pops the first N users and issues them a 15-minute access token in Redis. Explain what a sorted set is and why it's the right structure here.

**Commit:** `feat: waiting room queue`

---

### ☐ T35 🟡 — Waiting room UI

**Prompt:**

> Build the waiting room page: large animated number ticker counting down your queue position, an animated progress bar, estimated wait time, rotating reassurance messages, and an auto-redirect the instant you're admitted. Make it feel tense and premium — this is the page people screenshot.

**Commit:** `feat: waiting room UI`

---

## PHASE 10 — Organizer dashboard

### ☐ T36 🔴 — Analytics queries

**Prompt:**

> Create `src/db/queries/analytics.ts` with SQL (via Drizzle) for: total revenue per event, sell-through percentage per section, sales over time bucketed by hour, a conversion funnel (holds created → holds converted to paid), and average time from hold to purchase. Use window functions where appropriate. Explain each query.

**Commit:** `feat: analytics queries`

---

### ☐ T37 🟡 — Dashboard UI

**Prompt:**

> Build `/organizer/events/[id]` with animated stat cards (revenue, tickets sold, sell-through, check-ins), a Recharts area chart of sales over time, a bar chart of sell-through by section, and a live-updating list of recent orders. Numbers should count up on mount.

**Commit:** `feat: organizer dashboard`

---

### ☐ T38 🟢 — Query performance

**Prompt:**

> Run EXPLAIN ANALYZE on the three heaviest queries in the app. Show me the output, identify any sequential scans on large tables, add the indexes needed, and show the before/after timings. Explain how to read an EXPLAIN output.

**Commit:** `perf: add indexes based on query plans`

> 📸 Before/after numbers go in your README.

---

## PHASE 11 — Design & animation

### ☐ T39 🔴 — Landing page

Browse **Magic UI**, **Aceternity UI**, and **React Bits** first. Pick a hero, a bento grid, and a marquee you like.

**Prompt:**

> Build the landing page `/`. Hero with an animated gradient background and staggered text reveal, a live "next drop" countdown, a bento grid of featured events, a scroll-triggered "how it works" section, and a footer. I want to use [paste the component code you picked] — integrate it properly with our theme.

**Commit:** `feat: landing page`

---

### ☐ T40 🟡 — Design system pass

**Prompt:**

> Audit every page for visual consistency. Define a proper colour scale, spacing rhythm, and type scale in the Tailwind config and apply it everywhere. Add page transition animations. Make sure the seat map is usable on a phone.

**Commit:** `style: design system consistency pass`

---

### ☐ T41 🟢 — Empty, loading and error states

**Prompt:**

> Add a `loading.tsx` and `error.tsx` for every route segment, a custom `not-found.tsx`, and a designed empty state for: no events, no tickets, sold-out event. Add a global error boundary.

**Commit:** `feat: loading and error states`

---

## PHASE 12 — Proof (the part that makes it credible)

### ☐ T42 🔴 — Load test

**Prompt:**

> Write a k6 load test at `loadtest/holds.js`: 500 virtual users over 30 seconds all attempting to hold seats from a pool of 100 on the same event. After the run, query the database and assert that no seat has more than one live hold and no seat appears on more than one paid order. Give me the exact commands to install k6 on Windows and run it against my local server, then against the Vercel deployment.

**Record these numbers — they are your CV bullet:**
- Requests: ______
- Oversells: ______ (must be 0)
- p95 latency: ______ ms
- Success/conflict split: ______

**Commit:** `test: k6 load test`

---

### ☐ T43 🟡 — Unit and E2E tests

**Prompt:**

> Set up Vitest and write unit tests for: hold expiry logic, QR signature generation and verification, and price calculation. Then set up Playwright and write one E2E test covering the full path — sign up, browse events, select seats, hold, checkout with the Stripe test card, and see the success page.

**Commit:** `test: unit and e2e tests`

---

### ☐ T44 🟢 — CI pipeline

**Prompt:**

> Create `.github/workflows/ci.yml` running on every push and pull request: install deps, typecheck, lint, run Vitest. Add a status badge to the README.

**Verify:** open a PR and watch the check go green.
**Commit:** `ci: github actions pipeline`

---

### ☐ T45 🟡 — Monitoring & security pass

**Prompt:**

> Add Sentry for error tracking and Vercel Analytics. Then audit the whole app for: any API route missing auth checks, any missing Zod validation, any place the service role key could leak to the client, and any user input rendered without escaping. Fix what you find and list what you fixed.

**Commit:** `feat: monitoring and security fixes`

---

## PHASE 13 — Ship

### ☐ T46 🟡 — Production environment

In the Vercel dashboard → Settings → Environment Variables, add every variable for **Production** and **Preview**.

In Stripe, create a webhook endpoint pointing at `https://your-app.vercel.app/api/webhooks/stripe`. **It gets a different signing secret than your local one** — this trips up everybody. Put that one in Vercel.

**Verify:** complete a real test purchase on the live URL.

---

### ☐ T47 🟢 — Demo mode

**Prompt:**

> Add a `/api/demo/reset` route protected by a secret that re-seeds the database to a clean demo state, and a small floating "Reset demo" button visible only to organizer accounts. This lets me re-run my demo without the seats already being sold.

**Commit:** `feat: demo reset`

> This will save your presentation. Trust me.

---

### ☐ T48 🟡 — README

**Prompt:**

> Write a professional README: one-line pitch, live demo link, screenshots and GIFs (I'll add the files), the architecture diagram as Mermaid, the ER diagram, tech stack table, "engineering highlights" section covering the concurrency control, webhook idempotency and load test results, local setup instructions, and an "if I had more time" section.

**Commit:** `docs: readme`

---

### ☐ T49 🟢 — Demo video

Record 90 seconds, in this order:
1. Landing page scroll (5s)
2. Waiting room countdown (10s)
3. **Two windows racing for the same seat** (20s)
4. Checkout with the test card (15s)
5. Email arriving with the QR (10s)
6. Scanning the ticket → VALID, scanning again → ALREADY USED (15s)
7. Dashboard numbers updating (10s)
8. k6 load test output: 0 oversells (15s)

Use OBS Studio (free). Put it at the top of your README.

---

### ☐ T50 🟢 — Custom domain + CV

Grab a domain (free with the GitHub Student Pack) and point it at Vercel.

**Prompt:**

> Read the whole repo and this PLAN.md. Write me 4 CV bullet points about this project, using the real numbers from my load test. Then generate 8 technical interview questions someone would ask about this project, with strong answers, so I can prepare.

---

## Progress tracker

| Phase | Tasks | Done |
|---|---|---|
| 0 · Setup | T00–T02 | ☐ |
| 1 · Foundation | T03–T07 | ☐ |
| 2 · Database | T08–T12 | ☐ |
| 3 · Auth | T13–T16 | ☐ |
| 4 · Public pages | T17–T18 | ☑ |
| 5 · **Booking engine** | T19–T25 | ☐ |
| 6 · Payments | T26–T29 | ☑ |
| 7 · Tickets & check-in | T30–T32 | ☐ |
| 8 · Realtime | T33 | ☐ |
| 9 · Waiting room | T34–T35 | ☐ |
| 10 · Dashboard | T36–T38 | ☐ |
| 11 · Design | T39–T41 | ☐ |
| 12 · Proof | T42–T45 | ☐ |
| 13 · Ship | T46–T50 | ☐ |

**51 tasks.** At 2 per session, that's roughly 26 sessions — comfortably inside a month with buffer for the days something breaks.

---

## If you fall behind

Cut in this order, and no other:
1. Waiting room (T34–T35)
2. Organizer dashboard (T36–T38)
3. Email (T32)
4. Gate scanner (T30–T31)

**Never cut:** T20, T21, T28, T42. The hold transaction, the race proof, the idempotent webhook, and the load test *are* the reason this project is worth putting on a CV.

---

## Things that will bite you

- **Supabase free projects pause after about a week of inactivity.** Open the dashboard and hit your app 24 hours before any demo or interview.
- **The Stripe production webhook secret is different from your local CLI one.** You will forget this. It's this bullet point.
- **Never commit `.env.local`.** Check `.gitignore` before every push in the first week.
- **Next.js 16 renamed `middleware.ts` to `proxy.ts`.** Most tutorials online are still wrong about this.
- **OneDrive-synced folders cause weird file-lock errors on Windows.** Keep the project somewhere like `C:\projects\rush`, not in Documents.
