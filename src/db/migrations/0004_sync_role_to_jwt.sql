-- Mirror public.users.role into auth.users.raw_app_meta_data, so the role
-- travels inside the signed JWT.
--
-- WHY
--
-- src/proxy.ts runs before EVERY matched request. If it had to query the users
-- table to learn someone's role, every page load in the application would pay
-- for a database round trip before rendering even began. Next's own
-- documentation is explicit that proxy "is not intended for slow data fetching".
--
-- Supabase copies `raw_app_meta_data` into the access token as the
-- `app_metadata` claim, and that token is cryptographically signed. So once the
-- role lives here, the proxy can read a TRUSTWORTHY role straight out of the
-- verified token with no query at all.
--
-- Crucially this is `app_metadata`, not `user_metadata`. The two look
-- interchangeable and are not: user_metadata is writable by the logged-in user
-- through the ordinary client API. Storing a role there would let any account
-- promote itself to organizer by editing its own profile. app_metadata can only
-- be written with the service-role key or, as here, from inside the database.
--
-- THE TRADE-OFF, STATED PLAINLY
--
-- A JWT is a snapshot. Changing someone's role here does not alter tokens
-- already issued - the change lands when their access token next refreshes,
-- within roughly an hour. That is acceptable for the proxy because the proxy is
-- only an optimistic gate: src/lib/auth.ts re-checks the role against this table
-- inside the page itself, where the answer is always current. Fast path from the
-- token, authoritative path from the database.

create or replace function public.sync_role_to_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('role', new.role::text)
   where id = new.id
     -- Skip the write when it would change nothing. Without this guard every
     -- profile edit rewrites the auth row for no reason.
     and coalesce(raw_app_meta_data ->> 'role', '') is distinct from new.role::text;

  return new;
end;
$$;

drop trigger if exists on_user_role_changed on public.users;

-- Fires on insert as well as on a role change, so an account is never left with
-- a role in one table and nothing in the token.
create trigger on_user_role_changed
  after insert or update of role on public.users
  for each row execute function public.sync_role_to_auth_metadata();

-- Backfill everyone who already exists. Demo accounts created by the seed have
-- no auth.users row at all, so the update simply matches nothing for them.
update public.users set role = role;
