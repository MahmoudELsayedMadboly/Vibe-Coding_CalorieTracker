import { createClient } from "@supabase/supabase-js";

// These are the "anon public" values — safe to be visible in frontend code.
// Real protection comes from database rules (Row Level Security), not from
// hiding this key.
const SUPABASE_URL = "https://ooiivltxmkarqgmvfloh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vaWl2bHR4bWthcnFnbXZmbG9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDM4MjgsImV4cCI6MjEwMzc3OTgyOH0.j8DSg-tNOa4oZG198L9PcutjPr2r4UBYQW80pUrGdpI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
