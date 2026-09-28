-- Two intentionally distinct weight fields:
--   profile.original_weight_kg  — fixed starting point, entered at setup and
--                                 locked by the app once a check-in records a weight.
--   body_measurements.weight_kg — per check-in, the weight trend over time.
-- BMI is never stored per check-in; the app computes it from the latest
-- check-in weight, falling back to original_weight_kg.
--
-- Both statements were already run in production; this file records them
-- and is safe to re-run. Run in the Supabase SQL editor (as postgres).
-- Existing RLS policies (incl. "coach can view own clients body
-- measurements") cover the new column; no policy changes.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profile' and column_name = 'weight_kg'
  ) then
    alter table public.profile rename column weight_kg to original_weight_kg;
  end if;
end $$;

alter table public.body_measurements add column if not exists weight_kg numeric;
