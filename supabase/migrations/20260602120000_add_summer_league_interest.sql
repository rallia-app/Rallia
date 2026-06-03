-- ============================================================================
-- Migration: summer_league_interest table
-- Created: 2026-06-02
-- Description:
--   Backs the in-app "Rallia Summer League" announcement popup (mobile). When a
--   player taps "I'm interested", we record one row here so we can size demand
--   and segment by the player's existing profile (sport, rating, city) to tailor
--   the inaugural edition to the players who actually want in.
--
--   One row per player (idempotent): re-taps upsert ON CONFLICT DO NOTHING.
--
--   User-owned data: RLS restricts every row to its owner (auth.uid() = player_id).
--   Players may read and insert their own interest; service_role has full access
--   for admin/analytics paths.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.summer_league_interest (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
  source     TEXT NOT NULL DEFAULT 'mobile_app_popup',
  locale     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One interest signal per player; re-taps upsert into the same row.
  CONSTRAINT summer_league_interest_player_unique UNIQUE (player_id)
);

CREATE INDEX IF NOT EXISTS summer_league_interest_created_at_idx
  ON public.summer_league_interest (created_at DESC);

COMMENT ON TABLE public.summer_league_interest IS
  'One row per player who expressed interest in the first Rallia Summer League '
  'via the in-app announcement. Sizes demand and lets us tailor the league to '
  'interested players (segmented by their existing player profile).';
COMMENT ON COLUMN public.summer_league_interest.source IS
  'Where the interest was captured (e.g. mobile_app_popup), for future surfaces.';
COMMENT ON COLUMN public.summer_league_interest.locale IS
  'Player UI locale at time of opt-in (e.g. en-US, fr-CA), for localized follow-up.';

-- Grants (user-owned: players append/read their own row, RLS gates rows) -------
GRANT SELECT, INSERT                 ON public.summer_league_interest TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.summer_league_interest TO service_role;

-- RLS -------------------------------------------------------------------------
ALTER TABLE public.summer_league_interest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Players can view own summer league interest"   ON public.summer_league_interest;
DROP POLICY IF EXISTS "Players can insert own summer league interest" ON public.summer_league_interest;

CREATE POLICY "Players can view own summer league interest"
  ON public.summer_league_interest FOR SELECT
  TO authenticated
  USING (auth.uid() = player_id);

CREATE POLICY "Players can insert own summer league interest"
  ON public.summer_league_interest FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = player_id);
