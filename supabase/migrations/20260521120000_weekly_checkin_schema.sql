-- =============================================================================
-- Weekly check-in wizard — schema
--
-- Three tables backing the new weekly check-in flow:
--
--   * player_streak             — current streak state (one row per player)
--   * player_weekly_checkin     — audit log (one row per player per ISO week)
--   * player_check_in_preferences — wizard preferences (one row per player)
--
-- Streak rule (Option C — hybrid with mercy):
--   * Streak = consecutive WEEKLY CHECK-INS. A missed goal does NOT break it.
--   * A missed check-in week consumes 1 freeze if available, else resets to 0.
--   * Freezes are earned at every 4-week milestone (cap 2 in inventory).
--   * Mercy is enforced by the Monday cron `compute-streak-reset`, not the RPC.
--
-- The `auto_create_matches` / `auto_invite_players` columns on
-- player_check_in_preferences are intentionally inert in this delivery —
-- the wizard captures the user's intent, but the follow-up match-creation
-- work is the one that reads them and acts. Storing them now establishes
-- the contract so the wizard ships independently.
-- =============================================================================


-- =============================================================================
-- player_streak
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.player_streak (
  player_id               UUID        PRIMARY KEY REFERENCES public.player(id) ON DELETE CASCADE,
  current_streak          SMALLINT    NOT NULL DEFAULT 0  CHECK (current_streak >= 0),
  longest_streak          SMALLINT    NOT NULL DEFAULT 0  CHECK (longest_streak >= 0),
  freeze_inventory        SMALLINT    NOT NULL DEFAULT 0  CHECK (freeze_inventory >= 0),
  freeze_cap              SMALLINT    NOT NULL DEFAULT 2  CHECK (freeze_cap >= 0),
  last_checkin_week_start DATE,                              -- Monday of the most recent checked-in ISO week
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_streak IS
  'Per-player current streak state. Read by the wizard cold-start and the Home banner. Written by record_weekly_checkin RPC and the Monday streak-reset cron.';
COMMENT ON COLUMN public.player_streak.freeze_inventory IS
  'Streak-freeze passes available. Capped at freeze_cap. Earned at each 4-week streak milestone, consumed by the Monday cron when a week is missed.';

ALTER TABLE public.player_streak ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own streak" ON public.player_streak;
CREATE POLICY "Users can view their own streak"
  ON public.player_streak FOR SELECT TO authenticated
  USING (auth.uid() = player_id);

-- All writes go through SECURITY DEFINER RPCs (record_weekly_checkin) and the
-- cron (compute-streak-reset, run as service_role). No direct INSERT/UPDATE/DELETE
-- policy for `authenticated` — RPCs bypass RLS via SECURITY DEFINER.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_streak TO service_role;
GRANT SELECT ON public.player_streak TO authenticated;


-- =============================================================================
-- player_weekly_checkin
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.player_weekly_checkin (
  player_id        UUID        NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
  week_start_date  DATE        NOT NULL,                       -- Monday of the ISO week
  frequency_goal   SMALLINT    CHECK (frequency_goal IS NULL OR (frequency_goal BETWEEN 1 AND 5)),
                                                               -- 1..5 (5 = "5 or more"). NULL when the row is a freeze-rescue entry.
  sessions_played  SMALLINT    CHECK (sessions_played IS NULL OR sessions_played >= 0),
                                                               -- backfilled at end of the week (separate cron, out of scope here)
  freeze_consumed  BOOLEAN     NOT NULL DEFAULT FALSE,         -- TRUE when this row was inserted by the Monday cron to rescue the streak
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, week_start_date)
);

COMMENT ON TABLE public.player_weekly_checkin IS
  'Audit log: one row per player per ISO week. Drives the goal-hit history strip and the banner trigger (no row for current week => banner shows).';
COMMENT ON COLUMN public.player_weekly_checkin.freeze_consumed IS
  'TRUE when the row was synthetically created by compute-streak-reset to consume a freeze and preserve the streak. frequency_goal will be NULL for these.';

ALTER TABLE public.player_weekly_checkin ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own check-ins" ON public.player_weekly_checkin;
CREATE POLICY "Users can view their own check-ins"
  ON public.player_weekly_checkin FOR SELECT TO authenticated
  USING (auth.uid() = player_id);

-- Writes are RPC/cron only. No direct INSERT/UPDATE/DELETE policy.

CREATE INDEX IF NOT EXISTS idx_player_weekly_checkin_player_recent
  ON public.player_weekly_checkin (player_id, week_start_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_weekly_checkin TO service_role;
GRANT SELECT ON public.player_weekly_checkin TO authenticated;


-- =============================================================================
-- player_check_in_preferences
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.player_check_in_preferences (
  player_id            UUID        PRIMARY KEY REFERENCES public.player(id) ON DELETE CASCADE,
  auto_create_matches  BOOLEAN     NOT NULL DEFAULT TRUE,
  auto_invite_players  BOOLEAN     NOT NULL DEFAULT TRUE,
  last_frequency_goal  SMALLINT    CHECK (last_frequency_goal IS NULL OR (last_frequency_goal BETWEEN 1 AND 5)),
                                                               -- Pre-selects the frequency pill on Step 3 of the next wizard run.
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_check_in_preferences IS
  'Per-player preferences captured by the wizard. auto_create_matches and auto_invite_players are READ by future match-creation logic; this table is the contract.';

ALTER TABLE public.player_check_in_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own check-in preferences" ON public.player_check_in_preferences;
CREATE POLICY "Users can view their own check-in preferences"
  ON public.player_check_in_preferences FOR SELECT TO authenticated
  USING (auth.uid() = player_id);

-- Writes via record_weekly_checkin RPC only.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_check_in_preferences TO service_role;
GRANT SELECT ON public.player_check_in_preferences TO authenticated;
