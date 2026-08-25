-- Mirror Supabase's auth.users into our public.users table.
--
-- WHY A DATABASE TRIGGER RATHER THAN APPLICATION CODE
--
-- PLAN.md T14 says to insert the users row from the signup handler. That works
-- until it doesn't, in three ways:
--
--   1. It is two operations that must both succeed. If signUp() creates the auth
--      user and the follow-up insert then fails - a dropped connection, a cold
--      start timing out - you are left with someone who can log in but has no
--      row in our users table. Every join against orders, holds and roles breaks
--      for that person, and nothing reports an error.
--   2. It only covers the one code path we remember to write. Add Google login
--      later, or invite a user from the Supabase dashboard, and those accounts
--      arrive with no users row at all.
--   3. It cannot be retried safely without extra bookkeeping.
--
-- A trigger makes the mirror row part of the same transaction that creates the
-- auth user. Either both exist or neither does, for every signup path there will
-- ever be, including ones added by people who never read this file.
--
-- SECURITY DEFINER is required: the trigger runs as whoever inserted into
-- auth.users (Supabase's internal auth role), which has no rights on our schema.
-- Running as the function owner instead lets it write public.users.
--
-- `set search_path = ''` with fully-qualified names is the standard hardening for
-- a SECURITY DEFINER function: without it, someone able to create objects in a
-- schema earlier on the search path could shadow a table name and have this
-- elevated function operate on theirs instead.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    -- Supabase stashes anything passed to signUp({ options: { data } }) here.
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    'buyer'
  )
  -- Idempotent on purpose. Supabase can re-run inserts on retries, and the demo
  -- reset in T47 recreates rows; neither should blow up account creation.
  on conflict (id) do update
    set email = excluded.email,
        name  = coalesce(excluded.name, public.users.name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Keep the email column in step if the user later changes it in Supabase Auth,
-- otherwise our copy silently rots and login lookups by email stop matching.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();
