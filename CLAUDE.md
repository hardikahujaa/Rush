@AGENTS.md

# RUSH — project context

## What this is

**RUSH is a high-demand ticket drop platform.** Think Ticketmaster for a stadium show:
thousands of people hit "buy" the same second for a few hundred seats. The entire
engineering point of the project is that **two people must never end up owning the
same seat**, even under heavy concurrent load.

`PLAN.md` at the repo root is the **authoritative build pipeline** — 51 tasks (T00–T50)
across 14 phases. Read it before starting any task. Tick the checkbox when a task is done.

The four tasks that must never be cut, because they are the reason this project is
CV-worthy: **T20** (hold transaction), **T21** (race proof), **T28** (idempotent
webhook), **T42** (load test).

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.2, App Router, Turbopack |
| Language | TypeScript, `strict: true` |
| UI | Tailwind CSS v4, shadcn/ui, Framer Motion, lucide-react |
| Database | Supabase (Postgres) |
| ORM | Drizzle |
| Cache / queue / rate limit | Upstash Redis |
| Auth | Supabase Auth via `@supabase/ssr` |
| Payments | Stripe Checkout (test mode), INR |
| Email | Resend + `@react-email/components` |
| Validation | Zod |
| Errors | Sentry |
| Hosting | Vercel (auto-deploy on push to `main`) |

## Folder structure

```
src/
  app/                  routes (App Router)
    api/                route handlers
    (marketing)/        public pages
  components/
    ui/                 shadcn/ui primitives — do not hand-edit
    <feature>/          feature components
  db/
    schema.ts           Drizzle table definitions
    index.ts            db client
    queries/            all query logic
    seed.ts
  lib/                  auth.ts, redis.ts, stripe.ts, utils.ts
proxy.ts                root — session refresh + route protection (NOT middleware.ts)
docs/                   erd.md, architecture notes
scripts/                race-test.ts and other one-off scripts
loadtest/               k6 scripts
```

## Rules for Claude

1. **TypeScript strict mode always.** No `any`. No `@ts-ignore` without a comment
   explaining why.
2. **Validate every API input with Zod.** Every route handler parses its body/params
   through a schema before touching the database. No exceptions.
3. **Never write raw SQL outside `src/db/`.** Query logic lives in `src/db/queries/`.
   Route handlers call those functions; they do not build SQL.
4. **Explain new concepts.** The developer is a beginner in React and TypeScript and is
   building this to learn. When introducing anything non-obvious — a transaction, a
   server component, a race condition, idempotency — explain what it is and why this
   approach, not just what the code says. Never leave code they cannot defend in an
   interview.
5. **Prefer server components.** Only add `"use client"` when the component genuinely
   needs interactivity, state, effects, or browser APIs. Push client boundaries as far
   down the tree as possible.

## Next.js 16 gotchas (verified against `node_modules/next/dist/docs/`)

Most tutorials and training data predate these. Do not trust memory here.

- **`middleware.ts` is now `proxy.ts`**, at the project root. The exported function must
  be named `proxy`. It runs on the **Node.js runtime only** — the edge runtime is not
  supported in `proxy`, and the runtime cannot be configured.
- **Request APIs are async.** `cookies()`, `headers()`, `draftMode()`, and `params` /
  `searchParams` in `page.tsx`, `layout.tsx` and `route.ts` are all Promises. You must
  `await` them. Synchronous access was removed in 16.
  ```ts
  export default async function Page(props: PageProps<'/events/[id]'>) {
    const { id } = await props.params
  }
  ```
- Use `npx next typegen` to generate the `PageProps<'/route'>`, `LayoutProps<'/route'>`
  and `RouteContext<'/route'>` type helpers.
- Turbopack is the default bundler; Turbopack config lives in `next.config.ts` under
  `turbopack`, not `experimental.turbo`.
- Config flags renamed: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`.
- `next lint` was removed — lint with `eslint` directly (already wired in `package.json`).

## Domain rules

- **Money is always integer cents** (`priceCents`). Never floats. Currency is INR.
- **A seat is never oversold.** Three independent layers enforce this and all three must
  stay intact:
  1. `one_live_hold_per_seat` — unique partial index on `holds(seat_id) WHERE released_at IS NULL`
  2. `one_sold_seat` — unique index on `order_items(seat_id)`
  3. `SELECT ... FOR UPDATE` row locks inside the hold transaction, seats ordered by id
     to prevent deadlock
- **Holds expire lazily.** A seat whose live hold has `expiresAt < now()` is treated as
  available *in the query itself*, in SQL — never rely on a cron job to free seats.
- **Max 4 seats per hold.**
- **Stripe webhooks are idempotent** via the `webhookEvents` table keyed on
  `stripeEventId`. Stripe retries; reprocessing must be a no-op.
- **Never trust the client for price.** Always recompute totals server-side from the
  `sections` table.

## Safety

- `.env.local` is gitignored and must stay that way. Check before every push.
- `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `QR_SIGNING_SECRET` and `CRON_SECRET`
  are server-only. They must never appear in a client component or any `NEXT_PUBLIC_*`
  variable.
- Supabase free projects pause after ~1 week idle — wake the dashboard before a demo.
- The Stripe **production** webhook signing secret differs from the local Stripe CLI one.
