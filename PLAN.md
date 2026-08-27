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

### ☐ T17 🟡 — Events listing page

**Prompt:**

> Build `/events` as a server component that queries all events with their venue and a computed count of available seats. Render them as animated cards showing poster, title, venue, date, price range, and a status badge. Add a loading.tsx skeleton. Explain how server components fetch data without an API route, and why that's different from what I'd do with plain React.

**Commit:** `feat: events listing`

---

### ☑ T18 🟡 — Event detail page

**Prompt:**

> Build `/events/[id]` showing event hero, description, venue info, section pricing table, and a countdown timer to `dropAt` if the event hasn't dropped yet. The countdown must be a client component. Handle the not-found case with `notFound()`.

**Verify:** the 2-minute countdown event actually ticks down.
**Commit:** `feat: event detail page`

---

## PHASE 5 — The booking engine 🔥

> This is the part that makes the project worth putting on a CV. Slow down here. Read every explanation.

### ☐ T19 🔴 — Seat map UI

**Prompt (Plan Mode):**

> Build a `SeatMap` client component for `/events/[id]/seats`. It receives seats grouped by section and row. Render as a grid: available = slate, held = amber with a slow pulse, sold = dark red and not clickable, selected = bright accent with a scale-up spring animation via Framer Motion. Include a stage indicator at the top and a legend. Clicking an available seat toggles selection (max 4 seats). Show a sticky bottom bar with selected seats and total price. No backend yet — local state only.

**Verify:** you can select and deselect seats and see the total update.
**Commit:** `feat: seat map UI`

---

### ☐ T20 🔴 — The hold API (the heart of the project)

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

**Verify:** hold a seat via the UI, check the `holds` table in Supabase.
**Commit:** `feat: seat hold API with row locking`

---

### ☐ T21 🔴 — Prove it works under contention

**Prompt:**

> Write a script `scripts/race-test.ts` that fires 20 simultaneous requests for the SAME seat id and reports how many succeeded. Exactly one must succeed. Run it and show me the output.

**Verify:** output says 1 success, 19 conflicts.
**Commit:** `test: concurrent hold race test`

> 📸 **Screenshot this output.** It goes in your README and your presentation.

---

### ☐ T22 🟡 — Lazy expiry

**Prompt:**

> Change every seat availability query so that a seat with status 'held' whose live hold has `expiresAt < now()` is treated as available. Do this in SQL, not in JavaScript. Explain why handling expiry lazily in the query is more reliable than depending on a scheduled cron job.

**Commit:** `feat: lazy hold expiry`

---

### ☐ T23 🟡 — Upstash Redis + rate limiting

Create an Upstash Redis database, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into `.env.local`.

**Prompt:**

> Install `@upstash/redis` and `@upstash/ratelimit`. Create `src/lib/redis.ts`. Add a sliding-window rate limit of 10 requests per 10 seconds per user on `/api/holds`, returning 429 with a `Retry-After` header when exceeded. Also mirror each hold into Redis as `hold:{seatId}` with a 600-second TTL. Explain what Redis is and why we use it alongside Postgres rather than instead of it.

**Verify:** spam the button — you get a 429.
**Commit:** `feat: redis rate limiting and hold cache`

---

### ☐ T24 🟡 — Hold countdown UI

**Prompt:**

> When the user holds seats, show a countdown ring (SVG circle with animated stroke-dashoffset) ticking down from 10 minutes. At 60 seconds turn it red and pulse. At zero, release the hold and refresh the seat map. Add a "Release seats" button. Use optimistic UI so seats respond instantly on click.

**Commit:** `feat: hold countdown`

---

### ☐ T25 🟢 — Release endpoint + cleanup cron

**Prompt:**

> Create `POST /api/holds/release` that sets `releasedAt` and returns seats to 'available', verifying the hold belongs to the requesting user. Also create `GET /api/cron/cleanup` that permanently releases expired holds, protected by a `CRON_SECRET` bearer token. Add `vercel.json` with a daily cron at 03:00 UTC hitting that route. Note that Vercel's Hobby plan limits cron frequency, which is fine because our expiry is already lazy — this is just housekeeping.

**Commit:** `feat: hold release and cleanup cron`

---

## PHASE 6 — Payments

### ☐ T26 🟡 — Stripe setup

Get your test-mode keys from the Stripe dashboard. Add to `.env.local`:
```
STRIPE_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

**Prompt:**

> Install the stripe SDK. Create `src/lib/stripe.ts`. Explain what a Checkout Session is and why we never handle card details ourselves.

**Commit:** `chore: stripe client`

---

### ☐ T27 🔴 — Checkout session

**Prompt (Plan Mode):**

> Create `POST /api/checkout`. It must: verify the user holds all requested seats and the holds haven't expired, create an `orders` row with status 'pending' plus `orderItems`, create a Stripe Checkout Session in INR with a line item per seat and `metadata.orderId`, set success and cancel URLs, and return the session URL. Wrap the order creation in a transaction.

**Verify:** clicking Pay takes you to a Stripe checkout page.
**Commit:** `feat: stripe checkout session`

---

### ☐ T28 🔴 — The webhook (this is the interview question)

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

---

### ☐ T29 🟢 — Success page

**Prompt:**

> Build `/orders/[id]/success` showing the confirmed order with a confetti burst on mount (canvas-confetti), the seat list, total paid, and a link to view tickets. Handle the case where the webhook hasn't landed yet by polling order status every 2 seconds for up to 20 seconds with a "confirming payment" state.

**Commit:** `feat: order success page`

> 🎓 That polling detail is a real-world touch most student projects miss — payment confirmation is asynchronous.

---

## PHASE 7 — Tickets & gate check-in

### ☐ T30 🔴 — Signed QR tickets

**Prompt:**

> Add `QR_SIGNING_SECRET` to env. When tickets are created, set `qrSignature` to an HMAC-SHA256 of `{ticketId}.{orderId}.{seatId}` using that secret. Build `/tickets` listing the user's tickets as animated 3D-tilt cards, each rendering a QR code (use the `qrcode` package) encoding `{ticketId}:{signature}`. Explain why we sign the QR instead of just encoding the ticket id.

**Commit:** `feat: signed QR tickets`

---

### ☐ T31 🔴 — Gate scanner

**Prompt:**

> Build `/scan` (staff-only). Use a camera QR scanner library to read codes. On scan, POST to `/api/checkin` which: verifies the HMAC signature, loads the ticket, and in a transaction sets `checkedInAt` only if it is currently null. Return one of three outcomes: VALID, ALREADY_USED (with the original check-in time), or INVALID_SIGNATURE. Show a full-screen green / amber / red animated result with the seat details, auto-resetting after 3 seconds.

**Verify:** scanning the same ticket twice gives VALID then ALREADY_USED.
**Commit:** `feat: gate check-in scanner`

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
| 4 · Public pages | T17–T18 | ☐ |
| 5 · **Booking engine** | T19–T25 | ☐ |
| 6 · Payments | T26–T29 | ☐ |
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
