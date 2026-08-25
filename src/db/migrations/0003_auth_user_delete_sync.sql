-- Complete the auth.users -> public.users mirror.
--
-- Migration 0002 handles insert and email-change. Delete was missing, so
-- removing an account in the Supabase dashboard left an orphaned public.users
-- row: invisible, unreachable, and quietly wrong.
--
-- Why a trigger and not a foreign key. The obvious fix is
-- `users.id references auth.users(id) on delete cascade`, which is the usual
-- Supabase pattern. It does not work here: src/db/seed.ts creates a demo
-- organizer and 40 demo buyers that have no auth.users rows at all, and a
-- foreign key would reject every one of them. Seed data has to keep working
-- without standing up 41 real auth accounts.
--
-- Note this deliberately does NOT force the delete through. If the person has
-- orders, the restrict foreign key on orders.user_id aborts the whole thing and
-- the dashboard delete fails with an error. That is the correct outcome: paid
-- order history should not evaporate because someone clicked delete on an
-- account.

create or replace function public.handle_auth_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.users where id = old.id;
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_auth_user_deleted();
