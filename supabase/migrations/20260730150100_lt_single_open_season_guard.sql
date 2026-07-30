-- ============================================================================
-- Leagues — one open season per league
-- ============================================================================
-- Nothing stopped an organizer from opening a second season while one was
-- already running: both would then invite the same roster to sessions and keep
-- two live standings tables side by side — an un-modeled state no screen or
-- spec accounts for. Drafting the NEXT season during the current one stays
-- legal (that is how clubs actually prepare); it is season_open that now
-- refuses with LEAGUE_HAS_OPEN_SEASON until the running one closes.
--
-- Body carried over from 20260726120000 (payout gate) unchanged apart from the
-- new guard.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.season_open(
    p_season_id   uuid,
    p_version_was integer
)
RETURNS seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_season    seasons;
    v_league    leagues;
    v_row       seasons;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_season.league_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    IF v_season.end_date < current_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_ENDED';
    END IF;

    -- One live season at a time: two open seasons would double-invite the
    -- roster and run parallel standings. Draft as many as you like; open when
    -- the current one has closed.
    IF EXISTS (
        SELECT 1 FROM seasons
         WHERE league_id = v_season.league_id AND status = 'open' AND id <> p_season_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_HAS_OPEN_SEASON';
    END IF;

    -- Never open a paid season the organizer can't actually be paid for.
    -- Mirrors tournament_open_registration's gate.
    IF v_season.entry_fee_cents > 0
       AND NOT EXISTS (
           SELECT 1 FROM player_stripe_account psa
            WHERE psa.player_id = v_league.organizer_id
              AND psa.charges_enabled = true
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYOUTS_SETUP_REQUIRED';
    END IF;

    UPDATE seasons
       SET status           = 'open',
           rules_locked_at  = now(),
           version          = version + 1,
           updated_at       = now()
     WHERE id      = p_season_id
       AND version = p_version_was
       AND status  = 'draft'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM seasons WHERE id = p_season_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_DRAFT';
    END IF;

    -- Roster-aware: free seeds every active member (unchanged); paid seeds nobody
    -- here, because nobody has paid yet — the season_members trigger adds each
    -- payer's row as they enroll.
    INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
    SELECT v_row.id, r.user_id,
           hashtext(v_row.id::text || r.user_id::text)::bigint
      FROM public.season_ranking_roster(v_row.id) r
    ON CONFLICT (season_id, user_id) DO NOTHING;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'season', v_row.id, 'open', v_caller_id,
        jsonb_build_object('league_id', v_row.league_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_open(uuid, integer) TO authenticated;
