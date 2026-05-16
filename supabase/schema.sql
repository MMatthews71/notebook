-- ============================================================
--  Supabase Schema — project: ozfwtvrdcxpykfaqlfhl
--  Pulled: 2026-05-11 via Management API (no Docker required)
-- ============================================================

-- ─── GOALS ────────────────────────────────────────────────
CREATE TABLE goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  why         text,
  icon        text NOT NULL DEFAULT '🎯',
  parent_id   uuid REFERENCES goals(id),
  user_id     uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── HABITS ───────────────────────────────────────────────
CREATE TABLE habits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  icon              text DEFAULT '🎯',
  frequency         text NOT NULL DEFAULT 'daily',
  scheduled_time    text,
  duration_minutes  integer,
  goal_id           uuid REFERENCES goals(id),
  target_count      integer DEFAULT 1,
  habit_type        text NOT NULL DEFAULT 'standard',
  user_id           uuid,
  created_at        timestamptz DEFAULT now()
);

-- ─── COMPLETIONS ──────────────────────────────────────────
CREATE TABLE completions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id   uuid NOT NULL REFERENCES habits(id),
  date       date NOT NULL,
  user_id    uuid,
  created_at timestamptz DEFAULT now()
);

-- ─── SKIPPED HABITS ───────────────────────────────────────
CREATE TABLE skipped_habits (
  habit_id   uuid NOT NULL REFERENCES habits(id),
  date       date NOT NULL,
  user_id    uuid,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (habit_id, date)
);

-- ─── FLEX OVERRIDES ───────────────────────────────────────
CREATE TABLE flex_overrides (
  habit_id   uuid NOT NULL REFERENCES habits(id),
  date       date NOT NULL,
  user_id    uuid,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (habit_id, date)
);

-- ─── TODOS ────────────────────────────────────────────────
CREATE TABLE todos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  goal_id       uuid REFERENCES goals(id),
  due_date      date,
  deadline      date,
  completed     boolean DEFAULT false,
  completed_at  date,
  target_count  integer DEFAULT 1,
  current_count integer DEFAULT 0,
  scheduled_time text,
  type          text DEFAULT 'standard',  -- 'standard' | 'streak'
  streak_dates  jsonb DEFAULT '[]',
  user_id       uuid,
  created_at    timestamptz DEFAULT now()
);

-- ─── TODO TEMPLATES ───────────────────────────────────────
CREATE TABLE todo_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label          text NOT NULL,
  name           text,
  goal_id        uuid REFERENCES goals(id),
  target_count   integer DEFAULT 1,
  scheduled_time text,
  user_id        uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── NOTES ────────────────────────────────────────────────
CREATE TABLE notes (
  id         uuid PRIMARY KEY,
  title      text NOT NULL DEFAULT 'Untitled',
  content    text NOT NULL DEFAULT '',
  is_legacy  boolean DEFAULT false,
  user_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── JOURNAL ENTRIES ──────────────────────────────────────
CREATE TABLE journal_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content    text NOT NULL,
  user_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── JOURNAL ANALYSES ─────────────────────────────────────
CREATE TABLE journal_analyses (
  entry_id    uuid PRIMARY KEY REFERENCES journal_entries(id),
  analysis    jsonb NOT NULL,
  user_id     uuid,
  analysed_at timestamptz DEFAULT now()
);

-- ─── DAILY ORDERS ─────────────────────────────────────────
-- Stores custom sort order for todo/habit items per day
CREATE TABLE daily_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  date        date NOT NULL,
  item_id     uuid NOT NULL,
  item_type   text NOT NULL,  -- 'todo' | 'habit'
  sort_order  integer NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (date, item_id, item_type)
);

-- ─── USER PREFERENCES ─────────────────────────────────────
CREATE TABLE user_preferences (
  user_id    uuid NOT NULL,
  key        text NOT NULL,
  value      jsonb,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (key)
);

-- ─── VIEWS ────────────────────────────────────────────────
-- habit_streaks: view of completion counts for last 7 days
-- today_summary: view of habits scheduled for today
-- (these are managed views — exact SQL not pulled here)

-- ─── NUTRITION PROFILE ───────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrition_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  age INTEGER NOT NULL,
  sex TEXT NOT NULL,
  height_cm NUMERIC NOT NULL,
  weight_kg NUMERIC NOT NULL,
  activity_level TEXT NOT NULL DEFAULT 'moderate',
  goal TEXT NOT NULL DEFAULT 'maintenance',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FOOD LOGS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS food_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  date TEXT NOT NULL,
  meal_type TEXT DEFAULT 'meal',
  food_name TEXT NOT NULL,
  fdc_id TEXT,
  serving_g NUMERIC NOT NULL DEFAULT 100,
  calories NUMERIC DEFAULT 0,
  protein_g NUMERIC DEFAULT 0,
  carbs_g NUMERIC DEFAULT 0,
  fat_g NUMERIC DEFAULT 0,
  fiber_g NUMERIC DEFAULT 0,
  sodium_mg NUMERIC DEFAULT 0,
  potassium_mg NUMERIC DEFAULT 0,
  calcium_mg NUMERIC DEFAULT 0,
  magnesium_mg NUMERIC DEFAULT 0,
  iron_mg NUMERIC DEFAULT 0,
  zinc_mg NUMERIC DEFAULT 0,
  vitamin_c_mg NUMERIC DEFAULT 0,
  vitamin_d_mcg NUMERIC DEFAULT 0,
  vitamin_b12_mcg NUMERIC DEFAULT 0,
  folate_mcg NUMERIC DEFAULT 0,
  vitamin_a_mcg NUMERIC DEFAULT 0,
  saturated_fat_g NUMERIC DEFAULT 0,
  sugar_g NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RLS POLICIES (summary) ───────────────────────────────
-- All tables currently use open public/anon policies (qual=true).
-- Auth is enforced at the app level via user_id column filtering.
--
-- Tables with RLS enabled: completions, goals, habits, todos
-- Policy: allow ALL for roles {public, anon}
