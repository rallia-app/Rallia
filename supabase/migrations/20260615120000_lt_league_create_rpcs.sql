-- ============================================
-- Leagues & Tournaments — V6: league + season lifecycle RPCs
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V6
--       specs/17-leagues-tournaments/leagues.md
--       specs/17-leagues-tournaments/data-model.md §Schema deltas
--
-- Ships:
--   Schema delta: leagues.min_rating / max_rating / min_reputation
--   lt_league_default_rules helper
--   league_create, league_join, league_approve_member
--   season_create, season_open
-- ============================================

-- =====================
-- Schema delta (leagues rating gates)
-- =====================

ALTER TABLE public.leagues
    ADD COLUMN IF NOT EXISTS min_rating numeric(3,1),
    ADD COLUMN IF NOT EXISTS max_rating numeric(3,1),
    ADD COLUMN IF NOT EXISTS min_reputation smallint;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'leagues_rating_range'
           AND conrelid = 'public.leagues'::regclass
    ) THEN
        ALTER TABLE public.leagues
            ADD CONSTRAINT leagues_rating_range CHECK (
                min_rating IS NULL OR max_rating IS NULL OR min_rating <= max_rating
            );
    END IF;
END $$;


-- =====================
-- Default rules helper
-- =====================

CREATE OR REPLACE FUNCTION public.lt_league_default_rules(p_sport_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_sport_name text;
    v_match_format text;
BEGIN
    SELECT name INTO v_sport_name FROM sport WHERE id = p_sport_id;
    IF v_sport_name IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SPORT_MISMATCH';
    END IF;

    v_match_format := CASE v_sport_name
        WHEN 'pickleball' THEN 'pickleball_to_11'
        ELSE 'two_of_three'
    END;

    RETURN jsonb_build_object(
        'matchFormat', v_match_format,
        'gamesPerSet', 6,
        'finalSetTiebreak', 'super_tb_10pt',
        'formatsAllowed', jsonb_build_array('singles'),
        'pointWin', 10,
        'pointLoss', 1,
        'pointNoShow', -5,
        'pointBye', 1,
        'pointDraw', 5,
        'pointRetirementWinner', 10,
        'pointRetirementLoser', 1,
        'pointWalkoverWinner', 10,
        'pointWalkoverLoser', 0,
        'enableBonuses', false,
        'tieBreakerOrder', jsonb_build_array(
            'totalPoints', 'headToHead', 'setDifference',
            'gameDifference', 'participationPercent', 'deterministicRandom'
        ),
        'formatWeights', jsonb_build_object(
            'singles', 1.0, 'doubles', 1.0, 'mixed_doubles', 1.0
        ),
        'defaultRatingForUnknown', 0
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lt_league_default_rules(uuid) TO authenticated;


-- =====================
-- league_create
-- =====================

CREATE OR REPLACE FUNCTION public.league_create(
    p_name              text,
    p_sport_id          uuid,
    p_description       text                          DEFAULT NULL,
    p_visibility        tournament_visibility         DEFAULT 'private',
    p_join_mode         tournament_registration_mode  DEFAULT 'approval',
    p_facility_id       uuid                          DEFAULT NULL,
    p_venue_name        text                          DEFAULT NULL,
    p_network_id        uuid                          DEFAULT NULL,
    p_min_rating        numeric                       DEFAULT NULL,
    p_max_rating        numeric                       DEFAULT NULL,
    p_min_reputation    smallint                      DEFAULT NULL
)
RETURNS leagues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_recent_count integer;
    v_rules        jsonb;
    v_row          leagues;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    PERFORM public.assert_caller_plays_sport(p_sport_id);

    IF p_network_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
              FROM network n
              JOIN network_type nt ON nt.id = n.network_type_id
             WHERE n.id = p_network_id
               AND nt.name = 'community'
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NETWORK_NOT_COMMUNITY';
        END IF;
    END IF;

    IF NOT public.is_admin() THEN
        SELECT count(*) INTO v_recent_count
          FROM leagues
         WHERE organizer_id = v_caller_id
           AND created_at  > now() - interval '24 hours';

        IF v_recent_count >= 5 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATE_LIMITED';
        END IF;
    END IF;

    v_rules := public.lt_league_default_rules(p_sport_id);

    INSERT INTO leagues (
        name, sport_id, description, visibility, join_mode,
        facility_id, venue_name, network_id,
        min_rating, max_rating, min_reputation,
        default_rules, organizer_id
    )
    VALUES (
        p_name, p_sport_id, p_description, p_visibility, p_join_mode,
        p_facility_id, p_venue_name, p_network_id,
        p_min_rating, p_max_rating, p_min_reputation,
        v_rules, v_caller_id
    )
    RETURNING * INTO v_row;

    INSERT INTO league_members (league_id, user_id, role, status, approved_at, approved_by)
    VALUES (v_row.id, v_caller_id, 'organizer', 'active', now(), v_caller_id);

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'league', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'name', v_row.name,
            'sport_id', v_row.sport_id,
            'visibility', v_row.visibility,
            'join_mode', v_row.join_mode
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_create(
    text, uuid, text, tournament_visibility, tournament_registration_mode,
    uuid, text, uuid, numeric, numeric, smallint
) TO authenticated;


-- =====================
-- league_join
-- =====================

CREATE OR REPLACE FUNCTION public.league_join(p_league_id uuid)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_league         leagues;
    v_rating         numeric;
    v_initial_status league_member_status;
    v_active_count   integer;
    v_existing       league_members;
    v_row            league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    IF v_league.organizer_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    PERFORM public.assert_caller_plays_sport(v_league.sport_id);

    SELECT * INTO v_existing
      FROM league_members
     WHERE league_id = p_league_id AND user_id = v_caller_id;

    IF v_existing.id IS NOT NULL AND v_existing.status IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_MEMBER';
    END IF;

    IF v_league.join_mode = 'invite_only' THEN
        IF v_existing.id IS NULL OR v_existing.status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
        END IF;
        UPDATE league_members
           SET status      = 'active',
               approved_at = now(),
               version     = version + 1,
               updated_at  = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'membership', v_row.id, 'join', v_caller_id,
            jsonb_build_object('league_id', p_league_id, 'status', v_row.status)
        );
        RETURN v_row;
    END IF;

    -- Rating gate
    IF v_league.min_rating IS NOT NULL OR v_league.max_rating IS NOT NULL THEN
        SELECT rs.value INTO v_rating
          FROM player_sport ps
          LEFT JOIN rating_score rs ON rs.id = ps.active_rating_score_id
         WHERE ps.player_id = v_caller_id
           AND ps.sport_id = v_league.sport_id
           AND ps.is_active = true;

        IF v_league.min_rating IS NOT NULL
           AND (v_rating IS NULL OR v_rating < v_league.min_rating) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATING_GATE_NOT_MET';
        END IF;

        IF v_league.max_rating IS NOT NULL
           AND v_rating IS NOT NULL
           AND v_rating > v_league.max_rating THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATING_GATE_NOT_MET';
        END IF;
    END IF;

    -- Reputation gate
    IF v_league.min_reputation IS NOT NULL THEN
        IF (SELECT reputation_score FROM player WHERE id = v_caller_id)
           < v_league.min_reputation THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REPUTATION_GATE_NOT_MET';
        END IF;
    END IF;

    SELECT count(*) INTO v_active_count
      FROM league_members
     WHERE league_id = p_league_id AND status = 'active';

    IF v_league.member_capacity IS NOT NULL
       AND v_active_count >= v_league.member_capacity
       AND NOT COALESCE(v_league.waitlist_enabled, false) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_FULL';
    END IF;

    IF v_league.join_mode = 'open' THEN
        v_initial_status := 'active';
    ELSE
        v_initial_status := 'pending';
    END IF;

    IF v_existing.id IS NOT NULL AND v_existing.status = 'inactive' THEN
        UPDATE league_members
           SET status      = v_initial_status,
               approved_at = CASE WHEN v_initial_status = 'active' THEN now() ELSE NULL END,
               left_at     = NULL,
               version     = version + 1,
               updated_at  = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO league_members (league_id, user_id, role, status, approved_at)
        VALUES (
            p_league_id, v_caller_id, 'member', v_initial_status,
            CASE WHEN v_initial_status = 'active' THEN now() ELSE NULL END
        )
        RETURNING * INTO v_row;
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'membership', v_row.id, 'join', v_caller_id,
        jsonb_build_object('league_id', p_league_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_join(uuid) TO authenticated;


-- =====================
-- league_approve_member
-- =====================

CREATE OR REPLACE FUNCTION public.league_approve_member(
    p_member_id   uuid,
    p_version_was integer
)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    league_members;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM league_members WHERE id = p_member_id;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_member.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    UPDATE league_members
       SET status      = 'active',
           approved_at = now(),
           approved_by = v_caller_id,
           version     = version + 1,
           updated_at  = now()
     WHERE id      = p_member_id
       AND version = p_version_was
       AND status  = 'pending'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM league_members WHERE id = p_member_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'membership', v_row.id, 'approve_member', v_caller_id,
        jsonb_build_object(
            'league_id', v_row.league_id,
            'user_id', v_row.user_id,
            'status', v_row.status
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_approve_member(uuid, integer) TO authenticated;


-- =====================
-- season_create
-- =====================

CREATE OR REPLACE FUNCTION public.season_create(
    p_league_id       uuid,
    p_name            text,
    p_start_date      date,
    p_end_date        date,
    p_rules_override  jsonb DEFAULT NULL
)
RETURNS seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_league    leagues;
    v_rules     jsonb;
    v_row       seasons;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(p_league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    IF p_end_date < p_start_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DATE_RANGE';
    END IF;

    v_rules := v_league.default_rules;
    IF p_rules_override IS NOT NULL THEN
        v_rules := v_rules || p_rules_override;
    END IF;

    INSERT INTO seasons (league_id, name, start_date, end_date, rules, status)
    VALUES (p_league_id, p_name, p_start_date, p_end_date, v_rules, 'draft')
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'season', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'league_id', p_league_id,
            'name', v_row.name,
            'start_date', v_row.start_date,
            'end_date', v_row.end_date
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_create(uuid, text, date, date, jsonb) TO authenticated;


-- =====================
-- season_open
-- =====================

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

    IF v_season.end_date < current_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_ENDED';
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

    INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
    SELECT
        v_row.id,
        lm.user_id,
        hashtext(v_row.id::text || lm.user_id::text)::bigint
      FROM league_members lm
     WHERE lm.league_id = v_row.league_id
       AND lm.status = 'active'
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
