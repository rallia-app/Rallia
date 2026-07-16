-- ============================================
-- Tournament ranking ("Points Rallia") — schema
-- ============================================
-- Spec: specs/tournament-ranking/README.md (rev 4).
-- Adds:
--   1. tournaments.completed_at + a BEFORE trigger that stamps it on the
--      status -> 'completed' transition (season resolution needs a stable
--      completion time; the existing flip only touches status/updated_at, and
--      updated_at is later clobbered by archiving).
--   2. ranking_season — one row per half-year, seeded historically (back to the
--      earliest completed tournament) and two seasons ahead.
--   3. tournament_ranking_points — the ledger (one row per player per completed
--      tournament), RLS-locked to reads; only the SECURITY DEFINER award
--      function writes it.
--
-- The award function + completion trigger ship in the next migration.
-- ============================================


-- --------------------------------------------
-- 1. tournaments.completed_at
-- --------------------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN public.tournaments.completed_at IS
  'Stable completion instant, stamped by tournaments_set_completed_at on the '
  'status -> completed transition. Drives ranking-season resolution.';

-- Backfill already-finished tournaments from updated_at (best available proxy;
-- for archived ones this is archive time, accepted per spec §2).
UPDATE public.tournaments
   SET completed_at = updated_at
 WHERE status IN ('completed', 'archived')
   AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.tournaments_set_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'completed'
       AND OLD.status IS DISTINCT FROM 'completed'
       AND NEW.completed_at IS NULL THEN
        NEW.completed_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_set_completed_at ON public.tournaments;
CREATE TRIGGER tournaments_set_completed_at
    BEFORE UPDATE ON public.tournaments
    FOR EACH ROW
    EXECUTE FUNCTION public.tournaments_set_completed_at();


-- --------------------------------------------
-- 2. ranking_season
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.ranking_season (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text NOT NULL UNIQUE,        -- '<year>-SS' | '<year>-FW', keyed by start year
    label      text NOT NULL,
    starts_at  timestamptz NOT NULL,        -- inclusive
    ends_at    timestamptz NOT NULL,        -- exclusive
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ranking_season_range CHECK (ends_at > starts_at)
);

COMMENT ON TABLE public.ranking_season IS
  'Half-year ranking seasons (SS: Apr 1 -> Oct 1; FW: Oct 1 -> Apr 1 next year, '
  'crosses year-end). Boundaries are midnight America/Toronto. Shared by all boards.';

-- Seed: from one year before the earliest completed tournament (a Jan-Mar
-- completion belongs to the prior year's FW, so the -1 guarantees coverage)
-- through two years ahead. Idempotent via ON CONFLICT.
DO $$
DECLARE
    v_start_year int;
    v_end_year   int;
    y            int;
BEGIN
    SELECT coalesce(
             extract(year FROM min(completed_at))::int,
             extract(year FROM now() AT TIME ZONE 'America/Toronto')::int
           )
      INTO v_start_year
      FROM public.tournaments
     WHERE completed_at IS NOT NULL;

    v_start_year := v_start_year - 1;
    v_end_year   := extract(year FROM now() AT TIME ZONE 'America/Toronto')::int + 2;

    FOR y IN v_start_year..v_end_year LOOP
        INSERT INTO public.ranking_season (code, label, starts_at, ends_at)
        VALUES (
            y || '-SS',
            'Printemps/Été ' || y,
            make_timestamptz(y,     4, 1, 0, 0, 0, 'America/Toronto'),
            make_timestamptz(y,    10, 1, 0, 0, 0, 'America/Toronto')
        )
        ON CONFLICT (code) DO NOTHING;

        INSERT INTO public.ranking_season (code, label, starts_at, ends_at)
        VALUES (
            y || '-FW',
            'Automne/Hiver ' || y,
            make_timestamptz(y,    10, 1, 0, 0, 0, 'America/Toronto'),
            make_timestamptz(y + 1, 4, 1, 0, 0, 0, 'America/Toronto')
        )
        ON CONFLICT (code) DO NOTHING;
    END LOOP;
END $$;

ALTER TABLE public.ranking_season ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ranking_season_select ON public.ranking_season;
CREATE POLICY ranking_season_select ON public.ranking_season
    FOR SELECT USING (true);

DROP POLICY IF EXISTS ranking_season_no_direct_write ON public.ranking_season;
CREATE POLICY ranking_season_no_direct_write ON public.ranking_season
    FOR ALL USING (false) WITH CHECK (false);

GRANT SELECT ON public.ranking_season TO authenticated, service_role;


-- --------------------------------------------
-- 3. tournament_ranking_points (the ledger)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_ranking_points (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id       uuid NOT NULL REFERENCES public.ranking_season(id) ON DELETE RESTRICT,
    tournament_id   uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    registration_id uuid NOT NULL REFERENCES public.tournament_registrations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
    sport_id        uuid NOT NULL REFERENCES public.sport(id) ON DELETE RESTRICT,
    level_bucket    text CHECK (level_bucket IN ('beginner', 'intermediate', 'advanced')),
    placement       text NOT NULL CHECK (placement IN ('champion', 'finalist', 'semifinal', 'quarterfinal', 'participated')),
    tier            text NOT NULL CHECK (tier IN ('local', 'regional', 'vedette')),
    points          int  NOT NULL,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT trp_unique_tournament_user UNIQUE (tournament_id, user_id)
);

COMMENT ON TABLE public.tournament_ranking_points IS
  'Source-of-truth ledger: one row per player per completed tournament. '
  'level_bucket is a snapshot for the optional level filter, not a board key. '
  'Written only by award_tournament_ranking_points (SECURITY DEFINER).';

-- Board read path sorts best-N per player within (season, sport).
CREATE INDEX IF NOT EXISTS trp_board_idx
    ON public.tournament_ranking_points (season_id, sport_id, user_id);

CREATE INDEX IF NOT EXISTS trp_tournament_idx
    ON public.tournament_ranking_points (tournament_id);

ALTER TABLE public.tournament_ranking_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trp_select ON public.tournament_ranking_points;
CREATE POLICY trp_select ON public.tournament_ranking_points
    FOR SELECT USING (true);

DROP POLICY IF EXISTS trp_no_direct_write ON public.tournament_ranking_points;
CREATE POLICY trp_no_direct_write ON public.tournament_ranking_points
    FOR ALL USING (false) WITH CHECK (false);

GRANT SELECT ON public.tournament_ranking_points TO authenticated, service_role;
