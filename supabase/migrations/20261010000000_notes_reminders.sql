-- Notes reminders for coaches and owners.
--
-- coach_notes was created in the SQL editor (no earlier migration) with a
-- coach_id column and one policy, "coach can manage own notes". Notes now
-- belong to any signed-in user (the app shows them to coaches and owners),
-- so coach_id becomes user_id and the policies become own-rows only.
--
-- Each reminder pops up twice in the app: 1 hour before reminder_at and at
-- reminder_at. pre_reminder_shown_at / due_reminder_shown_at record that a
-- pop-up was shown; the app claims each one with a conditional update
-- (where <column> is null), so only one tab/device shows it.
-- reminder_set_at is when reminder_at was last set, so the app can skip the
-- 1-hour pop-up for a reminder set less than an hour ahead.
--
-- Deploy order: deploy the frontend, then run this file right away (as
-- postgres, in the Supabase SQL editor). In between, only the Notes screen,
-- the Home reminders card and the reminder pop-ups fail to load. Safe to
-- re-run.

begin;

-- 1. coach_id -> user_id.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coach_notes' and column_name = 'coach_id'
  ) then
    alter table public.coach_notes rename column coach_id to user_id;
  end if;
end $$;

-- 2. Foreign key to auth.users: keep an existing one (renamed to match the
--    column), otherwise add one. Cascades like client_plan_drafts, since the
--    delete-user Edge Function only calls auth.admin.deleteUser().
do $$
declare
  fk_name text;
  orphan_count integer;
begin
  select c.conname into fk_name
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.conrelid = 'public.coach_notes'::regclass
    and c.contype = 'f'
    and c.confrelid = 'auth.users'::regclass
    and array_length(c.conkey, 1) = 1
    and a.attname = 'user_id';

  if fk_name is null then
    select count(*) into orphan_count
    from public.coach_notes n
    where not exists (select 1 from auth.users u where u.id = n.user_id);
    if orphan_count > 0 then
      raise exception 'coach_notes has % row(s) whose user_id is not in auth.users; resolve them before adding the foreign key', orphan_count;
    end if;

    alter table public.coach_notes
      add constraint coach_notes_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  elsif fk_name <> 'coach_notes_user_id_fkey' then
    execute format('alter table public.coach_notes rename constraint %I to coach_notes_user_id_fkey', fk_name);
  end if;
end $$;

-- 3. Reminder pop-up tracking.
alter table public.coach_notes add column if not exists pre_reminder_shown_at timestamptz;
alter table public.coach_notes add column if not exists due_reminder_shown_at timestamptz;
alter table public.coach_notes add column if not exists reminder_set_at timestamptz;

-- Existing reminders were last set no later than the note's last edit.
update public.coach_notes
set reminder_set_at = updated_at
where reminder_at is not null and reminder_set_at is null;

-- 4. A new or changed reminder starts fresh: both pop-ups pending, not
--    dismissed. Compares reminder_at itself (not updated_at), so an edit
--    that leaves the time alone keeps the reminder's state.
create or replace function public.coach_notes_reset_reminder_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.reminder_at is distinct from old.reminder_at then
    new.pre_reminder_shown_at := null;
    new.due_reminder_shown_at := null;
    new.reminder_dismissed := false;
    new.reminder_set_at := case when new.reminder_at is null then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists coach_notes_reset_reminder_state on public.coach_notes;
create trigger coach_notes_reset_reminder_state
  before insert or update on public.coach_notes
  for each row execute function public.coach_notes_reset_reminder_state();

-- 5. RLS: each user reads and writes only their own notes. The insert and
--    update checks stop anyone writing a note under another user's id.
alter table public.coach_notes enable row level security;

drop policy if exists "coach can manage own notes" on public.coach_notes;
drop policy if exists "users read own notes" on public.coach_notes;
drop policy if exists "users insert own notes" on public.coach_notes;
drop policy if exists "users update own notes" on public.coach_notes;
drop policy if exists "users delete own notes" on public.coach_notes;

create policy "users read own notes"
  on public.coach_notes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users insert own notes"
  on public.coach_notes for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "users update own notes"
  on public.coach_notes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "users delete own notes"
  on public.coach_notes for delete to authenticated
  using (user_id = (select auth.uid()));

-- 6. The reminders the app polls for.
create index if not exists coach_notes_user_reminder_idx
  on public.coach_notes (user_id, reminder_at)
  where reminder_dismissed = false;

-- 7. Per-account mute for the reminder chime. Users already update their
--    own user_info row (language, avatar), so no policy change is needed.
alter table public.user_info add column if not exists reminder_sound_muted boolean not null default false;

commit;
