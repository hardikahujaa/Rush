-- T33 — Realtime on `seats`, and the grant hardening that has to come with it.
--
-- THREE THINGS, AND THE THIRD IS THE IMPORTANT ONE.
--
--   1. Add `seats` to the realtime publication, so Postgres streams its row
--      changes to Supabase Realtime at all.
--   2. Add the project's FIRST row level security policy, because Realtime
--      enforces RLS: without a SELECT policy, a subscriber receives silence.
--   3. Revoke the write grants that `anon` and `authenticated` hold on every
--      table, because step 2 is the moment those grants stop being harmless.
--
-- ─── WHY STEP 3 BELONGS IN THIS MIGRATION ───────────────────────────────────
--
-- Before T33 this database was in an odd but safe state: RLS was ON for all ten
-- tables and there were ZERO policies, which is deny-all. Underneath that,
-- `anon` and `authenticated` had been granted
--
--     DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
-- on `seats`, `orders`, `tickets`, `users`, `webhook_events` — everything.
-- (Supabase grants these to the API roles by default; tables created through
-- Drizzle inherited them.) So the only thing standing between a visitor holding
-- the public anon key and `UPDATE tickets SET checked_in_at = NULL` was the
-- absence of a policy. RLS was doing one hundred percent of the work and the
-- grants contributed nothing.
--
-- T33 writes the first policy. From here on, every policy anyone adds is
-- layered on top of full DML — and `CREATE POLICY ... FOR ALL USING (true)` is
-- one of the most copy-pasted lines in the Supabase ecosystem. Adding a read
-- policy while leaving write grants in place is how a project ships a hole it
-- never meant to open.
--
-- Nothing in this application writes through the Supabase client. It is used
-- only for `auth.*` — verified: there is not one `.from()` call anywhere in
-- `src/`. Every read and write goes through Drizzle on the `postgres` role,
-- which has `rolbypassrls = true`, so revoking these grants cannot affect a
-- single query the app makes.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Stream `seats` row changes.
-- ───────────────────────────────────────────────────────────────────────────
--
-- `add table` errors if the table is already a member, so this is written to be
-- re-runnable: a migration that cannot be applied twice is a migration that
-- blocks a rebuild.
--
-- REPLICA IDENTITY is deliberately left at its default (primary key). The
-- subscription only cares about UPDATE, and an UPDATE's *new* record always
-- carries every column — `old_record` would be limited to the key, which is
-- fine because nothing here reads it. Setting `replica identity full` would
-- double the WAL volume for a seat table that gets hammered during a drop, to
-- supply data we do not use.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'seats'
  ) then
    alter publication supabase_realtime add table public.seats;
  end if;
end
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. The first RLS policy: `seats` is publicly readable.
-- ───────────────────────────────────────────────────────────────────────────
--
-- `FOR SELECT`, and never `FOR ALL`. That distinction is the entire point of
-- the note above: `FOR ALL` would hand `anon` insert, update and delete on the
-- seat inventory the moment this migration ran.
--
-- WHAT THIS EXPOSES, stated plainly: id, event_id, section_id, row_label,
-- seat_no, status. No personal data of any kind, and `/events/[id]/seats`
-- already renders every one of those values to anybody who opens the page
-- without signing in. The policy grants the realtime socket exactly what the
-- HTML already shows.
--
-- WHAT IT DOES NOT COVER, equally deliberately: `holds` gets no policy, because
-- a hold row carries `user_id`. That is also why the client subscribes to
-- `seats` and not to `holds` — the seat's status is the public fact; who is
-- holding it is not.
--
-- `using (true)` rather than a tighter predicate because the data is already
-- public and a per-row condition would cost a check per streamed change for no
-- confidentiality gain.
drop policy if exists "seats are publicly readable" on public.seats;

create policy "seats are publicly readable"
  on public.seats
  for select
  to anon, authenticated
  using (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Take the write grants away from the public API roles.
-- ───────────────────────────────────────────────────────────────────────────
--
-- SELECT is kept: `seats` needs it for the realtime subscription above, and on
-- the other tables it remains gated by RLS, which still has no policy for them
-- and therefore still denies every row. Defence in depth, in the order it
-- should be: the grant says what a role may attempt, the policy says which rows
-- it may see.
--
-- TRUNCATE is revoked explicitly. It is not implied by DELETE, it ignores RLS
-- entirely because it is a table-level operation rather than a row-level one,
-- and `anon` holding it on `orders` was the single most alarming line in the
-- audit that prompted this.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- New tables must not quietly re-acquire what was just removed. Supabase sets
-- default privileges for these roles at the schema level, so without this the
-- next `drizzle-kit push` would hand the next table full DML again and this
-- migration would read as a one-off tidy-up rather than a standing rule.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated;

-- Sequences too: `anon` with UPDATE on a sequence can advance primary keys.
-- Nothing in this app lets the API roles insert, so USAGE buys them nothing.
revoke usage, update on all sequences in schema public from anon, authenticated;
