-- Draft / published plan versioning (bug 8).
--
-- Editing a plan no longer changes what the client sees until the coach
-- presses Send. A client's plan has up to two versions:
--   published — plan_foods rows with is_draft = false, plus the targets and
--               dates on client_profile. This is the only version the
--               client can read.
--   draft     — plan_foods rows with is_draft = true, plus one
--               client_plan_drafts row holding the draft targets/dates.
--               Created lazily by save_client_plan; removed by
--               send_client_plan or discard_client_plan_draft.
--
-- Draft targets/dates live in their own table rather than as draft_*
-- columns on client_profile: RLS is row-level, and the client can already
-- SELECT their own client_profile row, so draft columns there would reach
-- the client on any `select *`. client_plan_drafts has no client policy.
--
-- Depends on 20261003000000_plan_status_lifecycle.sql (plan_sent_at,
-- statuses, client_profile_plan_save_guard). Run this in the Supabase SQL
-- editor (as postgres). Safe to re-run.

-- 1. plan_foods: draft flag. Existing rows are the published plan.
alter table plan_foods add column if not exists is_draft boolean not null default false;

-- Restrictive policies AND with every existing permissive policy, so this
-- hides draft rows from the client without touching (or needing the names
-- of) the existing owner/coach policies. Coaches of the client still pass.
-- Standalone users never have draft rows, so they're unaffected.
drop policy if exists "draft plan rows are coach only" on plan_foods;
create policy "draft plan rows are coach only"
  on plan_foods
  as restrictive
  for all
  using (
    is_draft = false
    or exists (
      select 1 from coach_clients cc
      where cc.client_id = plan_foods.user_id
        and cc.coach_id = auth.uid()
    )
  )
  with check (
    is_draft = false
    or exists (
      select 1 from coach_clients cc
      where cc.client_id = plan_foods.user_id
        and cc.coach_id = auth.uid()
    )
  );

-- 2. Draft targets/dates. One row per client while a draft exists.
--    Cascades from auth.users: the delete-user Edge Function only calls
--    auth.admin.deleteUser(), so the row must go with the user.
create table if not exists client_plan_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_calories integer,
  target_protein_g integer,
  target_carb_g integer,
  target_fat_g integer,
  date_from date,
  date_to date,
  updated_at timestamptz not null default now()
);

alter table client_plan_drafts enable row level security;

-- Coach-only, scoped like the existing plan_foods coach policies
-- (coach_clients.status = 'active'). No client policy on purpose.
drop policy if exists "coach can manage own clients plan drafts" on client_plan_drafts;
create policy "coach can manage own clients plan drafts"
  on client_plan_drafts
  for all
  using (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = client_plan_drafts.user_id
        and cc.coach_id = auth.uid()
        and cc.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = client_plan_drafts.user_id
        and cc.coach_id = auth.uid()
        and cc.status = 'active'
    )
  );

-- 3. Save guard, reworked for drafts. Saves now only write draft rows, so
--    the guard moves to publishing: it checks whenever a plan becomes (or
--    stays) active with new targets. save_client_plan validates drafts.
--    Reactivating (inactive -> active, same targets) stays exempt.
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
  if new.plan_status is distinct from 'active' then
    return new;
  end if;

  needs_check :=
    (old.plan_status is null or old.plan_status not in ('active', 'inactive'))
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
  if not exists (select 1 from plan_foods pf where pf.user_id = new.user_id and pf.is_draft = false) then
    missing := array_append(missing, 'at least one food');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'Can''t publish this plan yet. Missing: %.', array_to_string(missing, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- 4. RPCs. SECURITY INVOKER: they run with the coach's own RLS, exactly
--    like the table calls they replace. Each runs in a single transaction.

create or replace function assert_coach_of_client(p_client_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from coach_clients cc
    where cc.client_id = p_client_id
      and cc.coach_id = auth.uid()
      and cc.status = 'active'
  ) then
    raise exception 'You can only edit plans for your own active clients.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Save the builder's full plan as the draft. Called only when the coach
-- clicks Save, so opening/leaving the builder never writes anything.
-- Replaces any existing draft rows (or creates them the first time); the
-- published rows are never touched. Draft rows always get fresh ids so
-- they can't collide with the published rows they were edited from.
create or replace function save_client_plan(
  p_client_id uuid,
  p_foods jsonb,
  p_plan_name text,
  p_date_from date,
  p_date_to date,
  p_target_calories integer,
  p_target_protein_g integer,
  p_target_carb_g integer,
  p_target_fat_g integer
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  missing text[] := '{}';
begin
  perform assert_coach_of_client(p_client_id);

  if coalesce(p_target_calories, 0) <= 0 then missing := array_append(missing, 'target calories'); end if;
  if coalesce(p_target_protein_g, 0) <= 0 then missing := array_append(missing, 'target protein'); end if;
  if coalesce(p_target_carb_g, 0) <= 0 then missing := array_append(missing, 'target carbs'); end if;
  if coalesce(p_target_fat_g, 0) <= 0 then missing := array_append(missing, 'target fat'); end if;
  if p_foods is null or jsonb_typeof(p_foods) <> 'array' or jsonb_array_length(p_foods) = 0 then
    missing := array_append(missing, 'at least one food');
  end if;
  if array_length(missing, 1) > 0 then
    raise exception 'Can''t save this plan yet. Missing: %.', array_to_string(missing, ', ')
      using errcode = 'check_violation';
  end if;

  if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
    raise exception '"Date to" can''t be earlier than "Date from".' using errcode = 'check_violation';
  end if;

  delete from plan_foods where user_id = p_client_id and is_draft = true;

  -- created_at is staggered by array position so the builder's order
  -- survives the "order by created_at" reads.
  insert into plan_foods (id, user_id, name, grams, meal, course, calories, plan_name, plan_date_from, plan_date_to, is_draft, created_at)
  select
    gen_random_uuid(),
    p_client_id,
    f.value->>'name',
    (f.value->>'grams')::numeric,
    f.value->>'meal',
    coalesce(f.value->>'course', 'Main'),
    (f.value->>'calories')::numeric,
    nullif(p_plan_name, ''),
    p_date_from,
    p_date_to,
    true,
    now() + (f.ordinality * interval '1 microsecond')
  from jsonb_array_elements(p_foods) with ordinality as f(value, ordinality);

  insert into client_plan_drafts (user_id, target_calories, target_protein_g, target_carb_g, target_fat_g, date_from, date_to, updated_at)
  values (p_client_id, p_target_calories, p_target_protein_g, p_target_carb_g, p_target_fat_g, p_date_from, p_date_to, now())
  on conflict (user_id) do update set
    target_calories = excluded.target_calories,
    target_protein_g = excluded.target_protein_g,
    target_carb_g = excluded.target_carb_g,
    target_fat_g = excluded.target_fat_g,
    date_from = excluded.date_from,
    date_to = excluded.date_to,
    updated_at = now();

  -- A plan that was never published is just a draft. A published plan
  -- (active or inactive) keeps its status; the coach sees "Draft" from the
  -- existence of draft rows.
  if not exists (select 1 from plan_foods where user_id = p_client_id and is_draft = false) then
    update client_profile set plan_status = 'draft' where user_id = p_client_id;
  end if;
end;
$$;

-- Publish the draft: replace the published rows with the draft rows, copy
-- the draft targets/dates onto client_profile, mark the plan active/sent,
-- and remove the draft. Works from draft, active (with unsent changes) and
-- inactive (Send reactivates).
create or replace function send_client_plan(p_client_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  d client_plan_drafts%rowtype;
begin
  perform assert_coach_of_client(p_client_id);

  if not exists (select 1 from plan_foods where user_id = p_client_id and is_draft = true) then
    raise exception 'There are no unsent changes to send.' using errcode = 'no_data_found';
  end if;

  select * into d from client_plan_drafts where user_id = p_client_id;
  if not found then
    raise exception 'This draft is missing its targets. Open the plan, check the targets and save again.'
      using errcode = 'no_data_found';
  end if;

  delete from plan_foods where user_id = p_client_id and is_draft = false;
  update plan_foods set is_draft = false where user_id = p_client_id and is_draft = true;

  update client_profile set
    target_calories = d.target_calories,
    target_protein_g = d.target_protein_g,
    target_carb_g = d.target_carb_g,
    target_fat_g = d.target_fat_g,
    date_from = d.date_from,
    date_to = d.date_to,
    plan_status = 'active',
    plan_sent_at = now()
  where user_id = p_client_id;

  delete from client_plan_drafts where user_id = p_client_id;
end;
$$;

-- Throw away the draft and fall back to the last published version (or to
-- no plan at all if it was never published).
create or replace function discard_client_plan_draft(p_client_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform assert_coach_of_client(p_client_id);

  delete from plan_foods where user_id = p_client_id and is_draft = true;
  delete from client_plan_drafts where user_id = p_client_id;

  if not exists (select 1 from plan_foods where user_id = p_client_id and is_draft = false) then
    update client_profile set plan_status = 'no_plan', plan_sent_at = null where user_id = p_client_id;
  end if;
end;
$$;

grant execute on function save_client_plan(uuid, jsonb, text, date, date, integer, integer, integer, integer) to authenticated;
grant execute on function send_client_plan(uuid) to authenticated;
grant execute on function discard_client_plan_draft(uuid) to authenticated;
grant execute on function assert_coach_of_client(uuid) to authenticated;
