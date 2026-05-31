-- ══════════════════════════════════════════════════════════════
--  Row Level Security — require authentication for all tables
--
--  Policy: auth.uid() IS NOT NULL
--  → Any signed-in user can read/write all rows.
--  → Unauthenticated requests (anon key alone) get nothing.
--
--  This is correct for a single-user personal app where only
--  the owner will ever create an account.
--  No data migration is needed — existing rows remain accessible
--  to the authenticated owner regardless of their user_id value.
-- ══════════════════════════════════════════════════════════════

-- ── Step 1: Enable RLS on every user-facing table ─────────────

ALTER TABLE IF EXISTS goals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS habits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS completions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS todos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS skipped_habits    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS flex_overrides    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS todo_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS journal_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS journal_analyses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS daily_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_preferences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS nutrition_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS food_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS saved_meals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS goal_parents      ENABLE ROW LEVEL SECURITY;

-- ── Step 2: Drop all existing policies on these tables ─────────
-- (Supabase may have created open "allow all" policies during setup)

DO $$
DECLARE
  pol RECORD;
  tables TEXT[] := ARRAY[
    'goals','habits','completions','todos',
    'skipped_habits','flex_overrides','todo_templates',
    'notes','journal_entries','journal_analyses',
    'daily_orders','user_preferences',
    'nutrition_profile','food_logs','saved_meals','goal_parents'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END
$$;

-- ── Step 3: Create authenticated-access policies ───────────────

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'goals','habits','completions','todos',
    'skipped_habits','flex_overrides','todo_templates',
    'notes','journal_entries','journal_analyses',
    'daily_orders','user_preferences',
    'nutrition_profile','food_logs','saved_meals','goal_parents'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Only create if the table actually exists in this project
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('
        CREATE POLICY "authenticated_access" ON public.%I
          FOR ALL
          USING     (auth.uid() IS NOT NULL)
          WITH CHECK (auth.uid() IS NOT NULL)
      ', t);
    END IF;
  END LOOP;
END
$$;

-- ── basiq_secrets: service-role only (no anon/user access) ────
-- The Edge Function uses the service-role key, which bypasses RLS.
-- No policy needed — RLS enabled with no policy = total lockout for anon/user.
ALTER TABLE IF EXISTS basiq_secrets ENABLE ROW LEVEL SECURITY;
