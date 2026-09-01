# Calorie Tracker

A calorie & macro tracker backed by Supabase. Configuration (profile, goal,
food list, meal plan) and daily logs are stored in a real Postgres database
instead of browser-only storage.

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
Supabase. Row Level Security is currently OFF on all four tables since this
is a single-user app with no login screen — before adding multiple users,
RLS needs to be enabled with real per-user policies.
