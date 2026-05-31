-- ══════════════════════════════════════════════════════════════
--  Revert RLS to open anon access
--
--  This app uses the anon key only (no user auth).
--  auth.uid() is always null, so the previous authenticated_access
--  policies blocked all data. Replace with open anon policies.
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  pol RECORD;
  tables TEXT[] := ARRAY[
    'goals','habits','completions','todos',
    'skipped_habits','flex_overrides','todo_templates',
    'notes','journal_entries','journal_analyses',
    'daily_orders','user_preferences',
    'nutrition_profile','food_logs','saved_meals','goal_parents',
    'finance_accounts','finance_transactions','finance_recurring'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop any existing policies
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- Create open access policy for anon role
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('
        CREATE POLICY "anon_access" ON public.%I
          FOR ALL TO anon
          USING (true)
          WITH CHECK (true)
      ', t);
    END IF;
  END LOOP;
END
$$;
