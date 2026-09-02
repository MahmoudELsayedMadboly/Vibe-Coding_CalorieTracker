# Calorie Tracker

A calorie & macro tracker backed by Supabase. Configuration (profile, goal,
food list, meal plan) and daily logs are stored in a real Postgres database
instead of browser-only storage.

Multi-user auth is implemented: the app requires signing up / logging in
with an email and password (Supabase Auth) before any data loads. Each
user's rows are scoped by a `user_id` column, and on a user's first login
any legacy unowned rows (`user_id IS NULL`) are automatically claimed by
that account.

## Deploying (Vercel, free)

1. Create a new GitHub repository and push this folder's contents to it.
2. Go to vercel.com, sign in with GitHub, and click "Add New Project."
3. Select the repository you just created. Vercel auto-detects Vite —
   leave the default build settings as they are.
4. Click Deploy. You'll get a free link like `your-project.vercel.app`.

No environment variables are required — the Supabase URL and anon key are
already set in `src/supabaseClient.js`.

## Local development

```
npm install
npm run dev
```

## Database

The `profile`, `personal_foods`, `plan_foods`, and `meal_logs` tables live in
Supabase, each with a `user_id` column. The app filters every query by the
logged-in user's `user_id`, but that's application-level scoping only —
confirm Row Level Security is enabled on all four tables with real
per-user policies (`user_id = auth.uid()`) in the Supabase dashboard, since
RLS is the actual security boundary, not the client-side filtering.
