-- Client files: clients attach images and PDFs (e.g. an InBody report) on
-- their Profile screen, and can list, open and delete them.
--
-- Files live in the private Storage bucket "client-files" under
-- "<user_id>/<uuid>.<ext>". Each file has a row in public.client_files, so
-- the app lists files without scanning Storage. These are health data:
-- the bucket is never public, and only the owner can read, add or delete
-- their files. No coach or owner access here (a separate follow-up).
--
-- Limits, enforced server-side:
--   - 10 MB per file and JPEG/PNG/WebP/PDF only: bucket settings (Storage
--     API) and check constraints on client_files.
--   - 20 files per client: trigger on client_files. An upload needs its
--     client_files row to exist first (storage insert policy), so the cap
--     can't be bypassed by uploading straight to Storage.
--
-- App flow: insert the row, upload the object to row.storage_path, and
-- delete the row if the upload fails. Delete: remove the object, then the
-- row.
--
-- Deploy order: run this file (as postgres, in the Supabase SQL editor),
-- then deploy the frontend. Additive only. Safe to re-run.

begin;

-- 1. Table.
create table if not exists public.client_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint client_files_path_check check (
    split_part(storage_path, '/', 1) = user_id::text
    and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
  ),
  constraint client_files_file_name_check check (char_length(file_name) between 1 and 255),
  constraint client_files_mime_type_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  constraint client_files_size_check check (size_bytes > 0 and size_bytes <= 10485760)
);

create index if not exists client_files_user_id_created_at_idx
  on public.client_files (user_id, created_at desc);

-- 2. 20 files per client. The advisory lock serialises concurrent inserts
--    for the same user, so parallel uploads can't overshoot the cap.
create or replace function public.client_files_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('client_files:' || new.user_id::text));
  if (select count(*) from public.client_files where user_id = new.user_id) >= 20 then
    raise exception 'You can attach up to 20 files. Delete one to add another.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists client_files_enforce_limit on public.client_files;
create trigger client_files_enforce_limit
  before insert on public.client_files
  for each row execute function public.client_files_enforce_limit();

-- 3. Row access: own rows only. No update — a file is added or deleted,
--    never edited.
alter table public.client_files enable row level security;

revoke all on public.client_files from anon;
revoke all on public.client_files from authenticated;
grant select, insert, delete on public.client_files to authenticated;

drop policy if exists "client can view own files" on public.client_files;
create policy "client can view own files"
  on public.client_files for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "client can add own files" on public.client_files;
create policy "client can add own files"
  on public.client_files for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "client can delete own files" on public.client_files;
create policy "client can delete own files"
  on public.client_files for delete
  to authenticated
  using (user_id = auth.uid());

-- 4. Bucket: private, 10 MB, the four allowed types. Re-running resets the
--    settings to these values.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-files',
  'client-files',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 5. Object access: only inside the caller's own "<user_id>/" folder.
--    Uploading also needs a matching client_files row (this is what makes
--    the 20-file cap apply to Storage). No update policy, so an existing
--    object can't be overwritten.
drop policy if exists "client can upload own client files" on storage.objects;
create policy "client can upload own client files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'client-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.client_files f
      where f.storage_path = storage.objects.name
        and f.user_id = auth.uid()
    )
  );

drop policy if exists "client can read own client files" on storage.objects;
create policy "client can read own client files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'client-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "client can delete own client files" on storage.objects;
create policy "client can delete own client files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'client-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
