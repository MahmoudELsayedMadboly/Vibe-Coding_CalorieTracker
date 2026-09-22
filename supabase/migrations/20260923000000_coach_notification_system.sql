-- Coach-defined notification event types, per-client assignments/overrides,
-- and the placeholder tokens usable in a message template.
--
-- This schema does not exist in the database yet (there was no prior
-- supabase/migrations folder in this repo). Run this file in the Supabase
-- SQL editor (or `supabase db push` if the CLI is linked) before using the
-- new Administration -> Notification screen, the top-level Notification
-- screen, or the coach-scoped calorie-threshold check.

create table if not exists coach_event_types (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  condition_kind text not null check (condition_kind in ('time', 'threshold')),
  default_value jsonb not null default '{}'::jsonb,
  message_template text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists client_event_assignments (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  event_type_id uuid not null references coach_event_types(id) on delete cascade,
  enabled boolean not null default true,
  override_value jsonb,
  last_sent_date date,
  created_at timestamptz not null default now(),
  unique (client_id, event_type_id)
);

create table if not exists notification_placeholders (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  label text not null,
  condition_kind text not null check (condition_kind in ('time', 'threshold', 'both')),
  created_at timestamptz not null default now()
);

insert into notification_placeholders (token, label, condition_kind) values
  ('{name}', 'Client name', 'both'),
  ('{calories}', 'Calories logged today', 'threshold'),
  ('{target}', 'Daily calorie target', 'threshold'),
  ('{percent}', 'Percent of target reached', 'threshold'),
  ('{time}', 'Scheduled time', 'time')
on conflict (token) do nothing;

alter table coach_event_types enable row level security;
alter table client_event_assignments enable row level security;
alter table notification_placeholders enable row level security;

-- coach_event_types: the owning coach has full access; a client can read an
-- event type only through an assignment pointing at it (needed so the
-- client's own session can evaluate their coach's threshold rules when they
-- log a meal).
drop policy if exists "coach manages own event types" on coach_event_types;
create policy "coach manages own event types"
  on coach_event_types for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

drop policy if exists "clients can read assigned event types" on coach_event_types;
create policy "clients can read assigned event types"
  on coach_event_types for select
  using (
    exists (
      select 1 from client_event_assignments cea
      where cea.event_type_id = coach_event_types.id
        and cea.client_id = auth.uid()
    )
  );

-- client_event_assignments: the owning coach has full access; the assigned
-- client can read their own rows and update them (needed to stamp
-- last_sent_date after a notification is sent from the client's own
-- session, mirroring how notification_settings.threshold_last_sent_date
-- already works today).
drop policy if exists "coach manages own client assignments" on client_event_assignments;
create policy "coach manages own client assignments"
  on client_event_assignments for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

drop policy if exists "clients can read own assignments" on client_event_assignments;
create policy "clients can read own assignments"
  on client_event_assignments for select
  using (client_id = auth.uid());

drop policy if exists "clients can update own assignments" on client_event_assignments;
create policy "clients can update own assignments"
  on client_event_assignments for update
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

-- notification_placeholders is shared reference data (read-only from the app).
drop policy if exists "authenticated users can read placeholders" on notification_placeholders;
create policy "authenticated users can read placeholders"
  on notification_placeholders for select
  using (auth.role() = 'authenticated');

-- Additive policy on the existing coach_clients table: lets a client read
-- their own row so the client-side threshold check can tell whether they
-- currently have an active coach. Only takes effect if RLS is already
-- enabled on coach_clients; harmless no-op otherwise.
drop policy if exists "clients can read own coach link" on coach_clients;
create policy "clients can read own coach link"
  on coach_clients for select
  using (client_id = auth.uid());

-- Additive policy on the existing notification_settings table: lets a coach
-- read/create/update the notification_settings row for one of their own
-- clients (needed for the Telegram "Connected"/"Copy invite link" section on
-- the coach's Client Details screen). Only takes effect if RLS is already
-- enabled on notification_settings; harmless no-op otherwise. Existing
-- self-access policies (a user managing their own row) are untouched.
drop policy if exists "coach can manage own clients notification settings" on notification_settings;
create policy "coach can manage own clients notification settings"
  on notification_settings for all
  using (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = notification_settings.user_id
        and cc.coach_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = notification_settings.user_id
        and cc.coach_id = auth.uid()
    )
  );
