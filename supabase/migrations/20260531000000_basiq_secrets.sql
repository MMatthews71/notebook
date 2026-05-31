-- ─── BASIQ SECRETS ────────────────────────────────────────────
-- Stores a per-device widget secret keyed to a Basiq user ID.
-- The Edge Function validates incoming requests against this table.
-- No RLS needed — only the Edge Function (service role) touches this.

CREATE TABLE IF NOT EXISTS basiq_secrets (
  basiq_user_id  text PRIMARY KEY,
  widget_secret  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
