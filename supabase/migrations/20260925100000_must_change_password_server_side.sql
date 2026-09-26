-- Make user_info.must_change_password server-controlled.
--
-- Before this, the "Set new password" screen cleared the flag with an
-- ordinary client-side update, so a user could call the API directly and
-- set it to false without ever changing their temp password.
--
-- 1. A trigger on auth.users clears the flag only when the password hash
--    actually changes (i.e. auth.updateUser({ password }) succeeded).
-- 2. A guard on user_info rejects any change to the flag made with an
--    end-user role (anon / authenticated). The Edge Functions
--    (service_role) and the trigger above (runs as its owner) still can.
--
-- Run this in the Supabase SQL editor (as postgres) before merging the
-- frontend change that stops writing the flag itself.

create or replace function public.clear_must_change_password_on_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.user_info
      set must_change_password = false
      where id = new.id and must_change_password;
  end if;
  return null;
end;
$$;

drop trigger if exists on_auth_user_password_changed on auth.users;
create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row
  execute function public.clear_must_change_password_on_password_change();

create or replace function public.guard_must_change_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.must_change_password is distinct from old.must_change_password
     and current_user in ('anon', 'authenticated') then
    raise exception 'must_change_password can only be changed by the server'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_must_change_password on public.user_info;
create trigger guard_must_change_password
  before update on public.user_info
  for each row
  execute function public.guard_must_change_password();
