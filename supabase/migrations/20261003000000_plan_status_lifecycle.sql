-- Plan status lifecycle on client_profile.plan_status:
--   no_plan  — no plan_foods rows for this client yet
--   draft    — plan saved by the coach but never sent (plan_sent_at is null)
--   active   — plan sent to the client (Send pressed; plan_sent_at set)
--   inactive — coach deactivated a previously sent plan
--
-- Also adds a server-side guard (update trigger) so a plan can't be saved as draft/active
-- (or have its targets changed while draft/active) unless all four daily
-- targets are set and at least one plan_foods row exists. The app disables
-- Save until then; this catches anything that bypasses the UI.
--
-- Run this in the Supabase SQL editor (as postgres). Safe to re-run.

-- The guard is recreated at the end; drop it first so re-running the
-- backfill below isn't blocked by it.
drop trigger if exists client_profile_plan_save_guard on client_profile;

-- 1. Track when the plan was sent to the client.
alter table client_profile add column if not exists plan_sent_at timestamptz;

-- 2. Backfill existing rows into the four states.
--    Previously-sent plans: give them a sent timestamp.
update client_profile
set plan_sent_at = now()
where plan_status in ('active', 'inactive')
  and plan_sent_at is null;

--    No plan foods at all -> no_plan (whatever was stored before).
update client_profile cp
set plan_status = 'no_plan', plan_sent_at = null
where not exists (select 1 from plan_foods pf where pf.user_id = cp.user_id)
  and plan_status is distinct from 'no_plan';

--    Plan foods exist but status was never set -> draft.
update client_profile cp
set plan_status = 'draft'
where plan_status is null
  and exists (select 1 from plan_foods pf where pf.user_id = cp.user_id);

-- 3. Default for new rows. No CHECK constraint on purpose: client_profile
--    rows are created by the create-user Edge Function (not in this repo),
--    and a constraint would break client creation if it writes a value
--    outside the four states. The app normalizes null/unknown values
--    against plan_foods (resolvePlanStatus in App.jsx).
alter table client_profile alter column plan_status set default 'no_plan';

-- 4. Save guard.
--    Checked when a plan enters draft/active (save or send) and when targets
--    change while draft/active. Not checked for inactive -> active
--    (reactivating an already-sent plan) or for unrelated column updates
--    (dates, plan type) so legacy plans without targets stay editable.
create or replace function client_profile_plan_save_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  missing text[] := '{}';
  needs_check boolean;
begin
  if new.plan_status is null or new.plan_status not in ('draft', 'active') then
    return new;
  end if;

  needs_check :=
    (new.plan_status is distinct from old.plan_status
      and not (old.plan_status = 'inactive' and new.plan_status = 'active'))
    or new.target_calories is distinct from old.target_calories
    or new.target_protein_g is distinct from old.target_protein_g
    or new.target_carb_g is distinct from old.target_carb_g
    or new.target_fat_g is distinct from old.target_fat_g;

  if not needs_check then
    return new;
  end if;

  if coalesce(new.target_calories, 0) <= 0 then missing := array_append(missing, 'target calories'); end if;
  if coalesce(new.target_protein_g, 0) <= 0 then missing := array_append(missing, 'target protein'); end if;
  if coalesce(new.target_carb_g, 0) <= 0 then missing := array_append(missing, 'target carbs'); end if;
  if coalesce(new.target_fat_g, 0) <= 0 then missing := array_append(missing, 'target fat'); end if;
  if not exists (select 1 from plan_foods pf where pf.user_id = new.user_id) then
    missing := array_append(missing, 'at least one food');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'Can''t save this plan yet. Missing: %.', array_to_string(missing, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists client_profile_plan_save_guard on client_profile;
create trigger client_profile_plan_save_guard
  before update on client_profile
  for each row execute function client_profile_plan_save_guard();
