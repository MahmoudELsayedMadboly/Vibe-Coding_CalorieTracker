-- Owner features: client list, client status, moving a client to another
-- coach, and owner <-> coach chat.
--
-- Every permission check goes through the link tables (owner_coaches,
-- coach_clients), never user_info.role_id. An owner reaches a client only
-- as: owner_coaches.owner_id = auth.uid() -> coach_id = coach_clients.coach_id.
--
-- Owners get no new RLS access to client tables. The client list comes from
-- owner_list_clients(), which returns only the columns the Clients screen
-- shows (name, email, coach, status, first login). Status changes and moves
-- go through the two RPCs below (security definer, checked inside).
--
-- Live facts this relies on: coach_clients has UNIQUE (client_id) (one coach
-- per client) and a status check (invited/active/inactive); owner_coaches
-- has UNIQUE (coach_id) (one owner per coach).
--
-- Run this in the Supabase SQL editor (as postgres). Safe to re-run.

begin;

-- 1. Client list for the signed-in owner, across all their coaches and
--    every link status.
create or replace function public.owner_list_clients()
returns table (
  client_id uuid,
  name text,
  email text,
  status text,
  coach_id uuid,
  coach_name text,
  first_login_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cc.client_id,
    ci.name::text,
    ci.email::text,
    cc.status::text,
    cc.coach_id,
    co.name::text,
    ci.first_login_at::timestamptz
  from public.owner_coaches oc
  join public.coach_clients cc on cc.coach_id = oc.coach_id
  left join public.user_info ci on ci.id = cc.client_id
  left join public.user_info co on co.id = cc.coach_id
  where oc.owner_id = auth.uid()
    and cc.client_id is not null
  order by ci.name nulls last;
$$;

-- 2. Deactivate / reactivate one of the owner's clients. Same transitions
--    as the coach's toggle: deactivating works from invited or active,
--    reactivating always goes to active. Either the owner or the coach can
--    reactivate.
create or replace function public.owner_set_client_status(p_client_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'Status must be active or inactive.' using errcode = '22023';
  end if;

  update public.coach_clients cc
  set status = p_status
  where cc.client_id = p_client_id
    and exists (
      select 1 from public.owner_coaches oc
      where oc.owner_id = auth.uid() and oc.coach_id = cc.coach_id
    );

  if not found then
    raise exception 'You can only change the status of your coaches'' clients.'
      using errcode = '42501';
  end if;
end;
$$;

-- 3. Move one of the owner's clients to another of the owner's active
--    coaches. Moves the existing coach_clients row (UNIQUE client_id), so
--    the old coach loses every coach_clients-based read policy at once.
--    The published plan and targets stay. Also:
--      - the unsent draft is dropped (as discard_client_plan_draft does),
--      - plan_type_id is cleared (plan types belong to the old coach),
--      - the old coach's notification rules for the client are removed.
--    Messages are untouched, so the old coach keeps their own chat history.
create or replace function public.owner_assign_client(p_client_id uuid, p_coach_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_coach uuid;
begin
  select cc.coach_id into v_old_coach
  from public.coach_clients cc
  join public.owner_coaches oc on oc.coach_id = cc.coach_id
  where cc.client_id = p_client_id
    and oc.owner_id = auth.uid()
  for update of cc;

  if not found then
    raise exception 'You can only move your coaches'' clients.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.owner_coaches oc
    where oc.owner_id = auth.uid()
      and oc.coach_id = p_coach_id
      and oc.status = 'active'
  ) then
    raise exception 'Clients can only be assigned to one of your active coaches.' using errcode = '42501';
  end if;

  if v_old_coach = p_coach_id then
    return;
  end if;

  update public.coach_clients set coach_id = p_coach_id where client_id = p_client_id;

  delete from public.plan_foods where user_id = p_client_id and is_draft = true;
  delete from public.client_plan_drafts where user_id = p_client_id;
  if not exists (select 1 from public.plan_foods where user_id = p_client_id and is_draft = false) then
    update public.client_profile set plan_status = 'no_plan', plan_sent_at = null where user_id = p_client_id;
  end if;

  update public.client_profile set plan_type_id = null where user_id = p_client_id and plan_type_id is not null;

  delete from public.client_event_assignments where client_id = p_client_id and coach_id = v_old_coach;
end;
$$;

revoke all on function public.owner_list_clients() from public, anon;
revoke all on function public.owner_set_client_status(uuid, text) from public, anon;
revoke all on function public.owner_assign_client(uuid, uuid) from public, anon;
grant execute on function public.owner_list_clients() to authenticated;
grant execute on function public.owner_set_client_status(uuid, text) to authenticated;
grant execute on function public.owner_assign_client(uuid, uuid) to authenticated;

-- 4. Owner <-> coach chat. The existing insert policy only allows a coach
--    and client with an active coach_clients link; permissive policies OR
--    together, so this adds the owner and their (invited or active) coaches
--    in both directions. The existing select (sender or recipient) and
--    recipient update (read_at) policies already cover these messages.
--    The pair check is a security definer helper so it doesn't depend on
--    the caller's own read access to owner_coaches.
create or replace function public.is_owner_coach_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.owner_coaches oc
    where oc.status in ('invited', 'active')
      and ((oc.owner_id = p_a and oc.coach_id = p_b) or (oc.coach_id = p_a and oc.owner_id = p_b))
  );
$$;

revoke all on function public.is_owner_coach_pair(uuid, uuid) from public, anon;
grant execute on function public.is_owner_coach_pair(uuid, uuid) to authenticated;

drop policy if exists "owner and coach can message each other" on public.messages;
create policy "owner and coach can message each other"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_owner_coach_pair(sender_id, recipient_id)
  );

commit;
