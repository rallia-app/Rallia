-- Admin-gate event creation.
--
-- Rallia runs every tournament and league itself during this phase, so
-- creation is staff-only. Regular players keep full discovery and
-- participation; only the two create RPCs change.
--
-- Both functions previously called is_admin() solely to waive the 5-per-24h
-- rate limit, which left creation open to any authenticated player who plays
-- the sport. The client hides the entry points, but that is not a gate.
--
-- Bodies copied from the latest migration defining each function:
--   tournament_create -> 20260810170100_lt_pool_knockout_schema.sql
--   league_create     -> 20260807280000_lt_league_rules_config.sql
-- Only the authorization block is added; everything else is verbatim, so the
-- pool_knockout and league-rules work stays intact.

CREATE OR REPLACE FUNCTION public.tournament_create(
    p_name              text,
    p_sport_id          uuid,
    p_max_participants  smallint,
    p_start_date        timestamptz,
    p_end_date          timestamptz,
    p_description       text                          DEFAULT NULL,
    p_visibility        tournament_visibility         DEFAULT 'private',
    p_registration_mode tournament_registration_mode  DEFAULT 'open',
    p_bracket_type      bracket_type                  DEFAULT 'single_elimination',
    p_match_format      match_format                  DEFAULT NULL,
    p_entry_format      entry_format                  DEFAULT 'singles',
    p_facility_id       uuid                          DEFAULT NULL,
    p_venue_name        text                          DEFAULT NULL,
    p_network_id        uuid                          DEFAULT NULL,
    p_registration_opens_at  timestamptz              DEFAULT NULL,
    p_registration_closes_at timestamptz              DEFAULT NULL,
    p_rules             text                          DEFAULT NULL,
    p_logo_url          text                          DEFAULT NULL,
    p_min_rating        numeric                       DEFAULT NULL,
    p_fee               jsonb                         DEFAULT NULL,
    p_venue_address     text                          DEFAULT NULL,
    p_city              text                          DEFAULT NULL,
    p_prize_money_cents integer                       DEFAULT NULL,
    p_max_rating        numeric                       DEFAULT NULL,
    p_points_per_game   smallint                      DEFAULT NULL,
    p_pool_size         smallint                      DEFAULT NULL,
    p_qualifiers_per_pool smallint                    DEFAULT NULL
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id     uuid := auth.uid();
    v_sport_name    text;
    v_match_format  match_format;
    v_points        smallint;
    v_recent_count  integer;
    v_closes_at     timestamptz;
    v_pool_size     smallint;
    v_qualifiers    smallint;
    v_row           tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    PERFORM public.assert_caller_plays_sport(p_sport_id);

    -- Rallia runs every event during this phase: creation is staff-only.
    -- Discovery and participation stay open to all players.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHORIZED';
    END IF;


    IF p_min_rating IS NOT NULL AND p_max_rating IS NOT NULL
       AND p_max_rating < p_min_rating THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RATING_RANGE';
    END IF;

    -- Explicit, before the table CHECKs fire: check_violation below is mapped
    -- to INVALID_FEE_SETTINGS, which would be a lie for size/pool problems.
    IF p_bracket_type = 'pool_knockout' THEN
        IF p_max_participants NOT IN (8, 12, 16, 20, 24, 32) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_SIZE';
        END IF;
        v_pool_size  := COALESCE(p_pool_size, 4::smallint);
        v_qualifiers := COALESCE(p_qualifiers_per_pool, 2::smallint);
        IF v_pool_size NOT BETWEEN 3 AND 5 OR v_qualifiers NOT IN (1, 2) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_POOL_CONFIG';
        END IF;
    ELSE
        IF p_max_participants NOT IN (4, 8, 16, 32, 64, 128) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_SIZE';
        END IF;
        IF p_pool_size IS NOT NULL OR p_qualifiers_per_pool IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_POOL_CONFIG';
        END IF;
        v_pool_size  := NULL;
        v_qualifiers := NULL;
    END IF;

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
          FROM tournaments
         WHERE organizer_id = v_caller_id
           AND created_at  > now() - interval '24 hours';

        IF v_recent_count >= 5 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATE_LIMITED';
        END IF;
    END IF;

    SELECT name INTO v_sport_name FROM sport WHERE id = p_sport_id;

    v_match_format := COALESCE(p_match_format, 'two_of_three'::match_format);
    v_points       := p_points_per_game;

    IF v_match_format IN ('pickleball_to_11', 'pickleball_to_15', 'pickleball_to_21') THEN
        v_points := COALESCE(v_points, CASE v_match_format
            WHEN 'pickleball_to_11' THEN 11::smallint
            WHEN 'pickleball_to_15' THEN 15::smallint
            ELSE 21::smallint
        END);
        v_match_format := 'two_of_three'::match_format;
    END IF;

    IF v_sport_name = 'pickleball' THEN
        v_points := COALESCE(v_points, 11::smallint);
    END IF;

    IF v_points IS NOT NULL AND v_points NOT IN (11, 15, 21) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_POINTS_PER_GAME';
    END IF;

    v_closes_at := COALESCE(
        p_registration_closes_at,
        GREATEST(p_start_date - interval '24 hours', now())
    );

    INSERT INTO tournaments (
        name, sport_id, max_participants, start_date, end_date,
        description, rules, logo_url, min_rating, max_rating, visibility, registration_mode,
        bracket_type, match_format, points_per_game, entry_format,
        pool_size, qualifiers_per_pool,
        facility_id, venue_name, venue_address, city, network_id,
        registration_opens_at, registration_closes_at,
        organizer_id, prize_money_cents,
        entry_fee_cents, currency, fee_payer, payout_timing,
        refund_policy_kind, refund_partial_bps, refund_cutoff_at
    )
    VALUES (
        p_name, p_sport_id, p_max_participants, p_start_date, p_end_date,
        p_description, p_rules, p_logo_url, p_min_rating, p_max_rating, p_visibility, p_registration_mode,
        p_bracket_type, v_match_format, v_points, p_entry_format,
        v_pool_size, v_qualifiers,
        p_facility_id, p_venue_name, p_venue_address, p_city, p_network_id,
        p_registration_opens_at, v_closes_at,
        v_caller_id, p_prize_money_cents,
        COALESCE((p_fee->>'entry_fee_cents')::integer, 0),
        COALESCE(p_fee->>'currency', 'CAD'),
        COALESCE((p_fee->>'fee_payer')::fee_payer_enum, 'player_pays'),
        COALESCE((p_fee->>'payout_timing')::payout_timing_enum, 'hold_until_event_end'),
        COALESCE((p_fee->>'refund_policy_kind')::refund_policy_kind_enum, 'none'),
        (p_fee->>'refund_partial_bps')::integer,
        NULLIF(p_fee->>'refund_cutoff_at', '')::timestamptz
    )
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'name', v_row.name,
            'sport_id', v_row.sport_id,
            'max_participants', v_row.max_participants,
            'start_date', v_row.start_date,
            'end_date', v_row.end_date,
            'visibility', v_row.visibility,
            'registration_mode', v_row.registration_mode,
            'entry_fee_cents', v_row.entry_fee_cents,
            'fee_payer', v_row.fee_payer
        )
    );

    RETURN v_row;
EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FEE_SETTINGS';
    WHEN check_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FEE_SETTINGS';
END;
$$;

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
    p_min_reputation    smallint                      DEFAULT NULL,
    p_logo_url          text                          DEFAULT NULL,
    p_rules_override    jsonb                         DEFAULT NULL
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

    -- Rallia runs every event during this phase: creation is staff-only.
    -- Discovery and participation stay open to all players.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHORIZED';
    END IF;


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
    IF p_rules_override IS NOT NULL THEN
        IF jsonb_typeof(p_rules_override) <> 'object' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES';
        END IF;
        v_rules := v_rules || p_rules_override;
    END IF;
    PERFORM public.lt_assert_league_rules(v_rules);

    INSERT INTO leagues (
        name, sport_id, description, visibility, join_mode,
        facility_id, venue_name, network_id,
        min_rating, max_rating, min_reputation, logo_url,
        default_rules, organizer_id
    )
    VALUES (
        p_name, p_sport_id, p_description, p_visibility, p_join_mode,
        p_facility_id, p_venue_name, p_network_id,
        p_min_rating, p_max_rating, p_min_reputation, p_logo_url,
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
