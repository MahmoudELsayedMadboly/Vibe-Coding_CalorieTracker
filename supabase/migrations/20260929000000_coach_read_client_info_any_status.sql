-- Let a coach read their own clients' user_info and client_profile rows
-- regardless of coach_clients status. The existing coach policies on these
-- tables (created in the SQL editor, not recorded in migrations) only match
-- status = 'active', so deactivating a client blanked Client Details
-- ("(name unavailable)", "-" fields), and first_login_at came back null.
--
-- Same shape as 20260928000000_coach_read_client_profile_data.sql. Permissive
-- policies OR together, so these widen access even if the old status-scoped
-- policy is left in place. Additive and read-only.
--
-- To see the old policies (optional; drop them once this is in):
--   select tablename, policyname, cmd, qual from pg_policies
--   where tablename in ('user_info', 'client_profile');
--
-- Run this in the Supabase SQL editor (as postgres).

drop policy if exists "coach can view own clients user info any status" on user_info;
create policy "coach can view own clients user info any status"
  on user_info for select
  using (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = user_info.id
        and cc.coach_id = auth.uid()
    )
  );

drop policy if exists "coach can view own clients plan info any status" on client_profile;
create policy "coach can view own clients plan info any status"
  on client_profile for select
  using (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = client_profile.user_id
        and cc.coach_id = auth.uid()
    )
  );
