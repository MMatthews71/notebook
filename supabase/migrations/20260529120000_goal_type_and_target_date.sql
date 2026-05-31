-- ─────────────────────────────────────────────────────────────
--  Goals redesign: 3-way goal type + per-goal target date
--  Run this in the Supabase SQL editor (or `supabase db push`).
--  Safe to run more than once (IF NOT EXISTS / idempotent backfill).
-- ─────────────────────────────────────────────────────────────

-- 1) Goal type: 'milestone' (one-time), 'habit' (ongoing), 'hybrid' (ongoing + growth target)
ALTER TABLE goals ADD COLUMN IF NOT EXISTS goal_type text NOT NULL DEFAULT 'milestone';

-- 2) Optional real deadline. When set, the grid auto-places the goal into the
--    matching horizon (someday/week stay manual when no date is set).
ALTER TABLE goals ADD COLUMN IF NOT EXISTS target_date date;

-- 3) Backfill the new type from the legacy is_maintenance flag.
--    (Only touches rows still on the default so re-runs are harmless.)
UPDATE goals
   SET goal_type = 'habit'
 WHERE is_maintenance IS TRUE
   AND goal_type = 'milestone';

-- Optional guard: keep goal_type to the known set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goals_goal_type_check'
  ) THEN
    ALTER TABLE goals
      ADD CONSTRAINT goals_goal_type_check
      CHECK (goal_type IN ('milestone', 'habit', 'hybrid'));
  END IF;
END $$;
