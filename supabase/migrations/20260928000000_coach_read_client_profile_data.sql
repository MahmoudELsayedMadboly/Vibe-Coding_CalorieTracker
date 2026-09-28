-- Let a coach read the client-reported data shown on the Client Details
-- screen, for their own clients only (any coach_clients status, so a
-- deactivated client's history stays visible to their coach).
--
-- Mirrors the "owner can view own coaches" pattern: a row is visible when
-- its user_id is one of the current coach's clients via coach_clients.
-- Additive and read-only — the clients' own self-access policies are
-- untouched. Only takes effect where RLS is already enabled.
--
-- Run this in the Supabase SQL editor (as postgres).

-- profile: sex, age, date_of_birth, weight/height, activity, goal_type,
-- goal_rate, health_notes.
drop policy if exists "coach can view own clients profile" on profile;
create policy "coach can view own clients profile"
  on profile for select
  using (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = profile.user_id
        and cc.coach_id = auth.uid()
    )
  );

drop policy if exists "coach can view own clients body measurements" on body_measurements;
create policy "coach can view own clients body measurements"
  on body_measurements for select
  using (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = body_measurements.user_id
        and cc.coach_id = auth.uid()
    )
  );

drop policy if exists "coach can view own clients progress photos" on progress_photos;
create policy "coach can view own clients progress photos"
  on progress_photos for select
  using (
    exists (
      select 1 from coach_clients cc
      where cc.client_id = progress_photos.user_id
        and cc.coach_id = auth.uid()
    )
  );

-- The photo files themselves: progress-photos objects are stored under
-- "<client user_id>/...", so the first path segment identifies the client.
-- Needed for createSignedUrls from the coach's session.
drop policy if exists "coach can view own clients progress photo files" on storage.objects;
create policy "coach can view own clients progress photo files"
  on storage.objects for select
  using (
    bucket_id = 'progress-photos'
    and exists (
      select 1 from public.coach_clients cc
      where cc.client_id::text = (storage.foldername(storage.objects.name))[1]
        and cc.coach_id = auth.uid()
    )
  );
