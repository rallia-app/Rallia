-- ============================================================================
-- Leagues — the organizer sets the points system, not just the sport default
-- ============================================================================
-- Reported in the league test review: "À la création de la ligue, le créateur
-- doit définir le système de comptage des points."
--
-- Every point value the standings run on already lives in leagues.default_rules
-- and is already read by recalc_season_ranking. Nothing could write it:
-- league_create seeded the sport defaults and offered no override, and while
-- league_update accepted a default_rules patch, it REPLACED the whole object,
-- so a client editing one point value had to resend every key or silently drop
-- tieBreakerOrder, formatWeights and the rest.
--
-- Three changes:
--   * league_create takes p_rules_override, merged over the sport defaults,
--     mirroring season_create's parameter of the same name.
--   * league_update MERGES default_rules instead of replacing it. No client
--     writes this column today, so nothing depends on the replace semantics.
--   * both validate the result through lt_assert_league_rules, which is also
--     the first validation this column has ever had.
--
-- Known gap, deliberate: season_create's own p_rules_override stays unvalidated,
-- as it has been since it shipped. The league-level rules seed every season, so
-- that is the door worth locking first.
--
-- league_create is DROPped rather than replaced: adding a trailing defaulted
-- parameter to a CREATE OR REPLACE leaves the old signature in place as a second
-- overload, which makes the PostgREST call ambiguous. Clients name their
-- arguments, so the 12-argument callers keep working against the 13-argument
-- function.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- lt_assert_league_rules — the shape the ranking math depends on
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_assert_league_rules(p_rules jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_key text;
BEGIN
    IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES';
    END IF;

    -- Point values feed a sum, so a string or a null would break the recalc at
    -- score time rather than here. Negative is legal: pointNoShow defaults to -5.
    FOREACH v_key IN ARRAY ARRAY[
        'pointWin', 'pointLoss', 'pointDraw', 'pointBye', 'pointNoShow',
        'pointRetirementWinner', 'pointRetirementLoser',
        'pointWalkoverWinner', 'pointWalkoverLoser'
    ] LOOP
        IF p_rules ? v_key THEN
            IF jsonb_typeof(p_rules -> v_key) <> 'number' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
            END IF;
            IF (p_rules ->> v_key)::numeric NOT BETWEEN -100 AND 100 THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
            END IF;
        END IF;
    END LOOP;

    IF p_rules ? 'matchFormat'
       AND NOT EXISTS (
           SELECT 1
             FROM unnest(enum_range(NULL::match_format)) AS e(v)
            WHERE e.v::text = p_rules ->> 'matchFormat'
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:matchFormat';
    END IF;

    IF p_rules ? 'gamesPerSet'
       AND (jsonb_typeof(p_rules -> 'gamesPerSet') <> 'number'
            OR (p_rules ->> 'gamesPerSet')::integer NOT IN (4, 6, 8)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:gamesPerSet';
    END IF;

    IF p_rules ? 'pointsPerGame'
       AND (jsonb_typeof(p_rules -> 'pointsPerGame') <> 'number'
            OR (p_rules ->> 'pointsPerGame')::integer NOT IN (11, 15, 21)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:pointsPerGame';
    END IF;

    -- Games each player plays per session. sessions.rounds is CHECKed 1..6, so a
    -- season default outside that range could never be applied.
    IF p_rules ? 'gamesPerPlayer'
       AND (jsonb_typeof(p_rules -> 'gamesPerPlayer') <> 'number'
            OR (p_rules ->> 'gamesPerPlayer')::integer NOT BETWEEN 1 AND 6) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:gamesPerPlayer';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lt_assert_league_rules(jsonb) TO authenticated;

COMMENT ON FUNCTION public.lt_assert_league_rules(jsonb) IS
'Validates a league/season rules jsonb: point values numeric and within ±100,
matchFormat a real enum label, gamesPerSet 4/6/8, pointsPerGame 11/15/21,
gamesPerPlayer 1..6. Raises INVALID_RULES[:key].';

-- ---------------------------------------------------------------------------
-- league_create — same body as 20260716230200, plus the rules override
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.league_create(
    text, uuid, text, tournament_visibility, tournament_registration_mode,
    uuid, text, uuid, numeric, numeric, smallint, text);

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

GRANT EXECUTE ON FUNCTION public.league_create(
    text, uuid, text, tournament_visibility, tournament_registration_mode,
    uuid, text, uuid, numeric, numeric, smallint, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.league_create(
    text, uuid, text, tournament_visibility, tournament_registration_mode,
    uuid, text, uuid, numeric, numeric, smallint, text, jsonb) IS
'Creates a league and seats its organizer. p_rules_override merges over the
sport defaults from lt_league_default_rules and is validated by
lt_assert_league_rules. Rate limited to 5 leagues per organizer per 24h.';

-- ---------------------------------------------------------------------------
-- league_update — same body as 20260716180000, but default_rules merges and
-- is validated instead of being written through unchecked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_update(
    p_league_id   uuid,
    p_version_was integer,
    p_patch       jsonb
)
RETURNS leagues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_before    leagues;
    v_row       leagues;
    v_key       text;
    v_allowed   text[];
    v_new_min   numeric;
    v_new_max   numeric;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPTY_PATCH';
    END IF;

    IF NOT public.is_league_organizer(p_league_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_before FROM leagues WHERE id = p_league_id FOR UPDATE;
    IF v_before.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    IF v_before.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    IF v_before.status = 'closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_TERMINAL';
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        v_allowed := CASE v_key
            WHEN 'name'           THEN ARRAY['active','paused']
            WHEN 'description'    THEN ARRAY['active','paused']
            WHEN 'logo_url'       THEN ARRAY['active','paused']
            WHEN 'visibility'     THEN ARRAY['active','paused']
            WHEN 'join_mode'      THEN ARRAY['active','paused']
            WHEN 'facility_id'    THEN ARRAY['active','paused']
            WHEN 'venue_name'     THEN ARRAY['active','paused']
            WHEN 'surfaces'       THEN ARRAY['active','paused']
            WHEN 'categories'     THEN ARRAY['active','paused']
            WHEN 'level'          THEN ARRAY['active','paused']
            WHEN 'default_rules'  THEN ARRAY['active','paused']
            WHEN 'member_capacity'  THEN ARRAY['active','paused']
            WHEN 'waitlist_enabled' THEN ARRAY['active','paused']
            WHEN 'min_rating'     THEN ARRAY['active','paused']
            WHEN 'max_rating'     THEN ARRAY['active','paused']
            WHEN 'min_reputation' THEN ARRAY['active','paused']
            ELSE NULL
        END;

        IF v_allowed IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UNKNOWN_FIELD:' || v_key;
        END IF;
        IF NOT (v_before.status::text = ANY (v_allowed)) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FIELD_NOT_EDITABLE:' || v_key;
        END IF;
    END LOOP;

    IF p_patch ? 'name' AND (p_patch->>'name' IS NULL
        OR char_length(trim(p_patch->>'name')) NOT BETWEEN 1 AND 100) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_NAME';
    END IF;

    IF p_patch ? 'default_rules' THEN
        IF jsonb_typeof(p_patch->'default_rules') <> 'object' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
        END IF;
        -- Merged, not replaced: an editor that touches one point value must not
        -- silently drop tieBreakerOrder, formatWeights and the rest.
        PERFORM public.lt_assert_league_rules(
            v_before.default_rules || (p_patch->'default_rules'));
    END IF;

    IF p_patch ? 'member_capacity'
        AND NULLIF(p_patch->>'member_capacity', '') IS NOT NULL
        AND (p_patch->>'member_capacity')::integer < 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_MEMBER_CAPACITY';
    END IF;

    -- Resolve the post-patch rating window so a one-sided patch is validated
    -- against the stored other side, not just against itself.
    v_new_min := CASE WHEN p_patch ? 'min_rating'
                      THEN NULLIF(p_patch->>'min_rating', '')::numeric ELSE v_before.min_rating END;
    v_new_max := CASE WHEN p_patch ? 'max_rating'
                      THEN NULLIF(p_patch->>'max_rating', '')::numeric ELSE v_before.max_rating END;
    IF v_new_min IS NOT NULL AND v_new_max IS NOT NULL AND v_new_min > v_new_max THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RATING_RANGE';
    END IF;

    UPDATE leagues SET
        name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')  ELSE name        END,
        description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE description END,
        logo_url    = CASE WHEN p_patch ? 'logo_url'    THEN p_patch->>'logo_url'    ELSE logo_url    END,
        visibility  = CASE WHEN p_patch ? 'visibility'  THEN (p_patch->>'visibility')::tournament_visibility ELSE visibility END,
        join_mode   = CASE WHEN p_patch ? 'join_mode'   THEN (p_patch->>'join_mode')::tournament_registration_mode ELSE join_mode END,
        facility_id = CASE WHEN p_patch ? 'facility_id' THEN NULLIF(p_patch->>'facility_id', '')::uuid ELSE facility_id END,
        venue_name  = CASE WHEN p_patch ? 'venue_name'  THEN p_patch->>'venue_name'  ELSE venue_name  END,
        surfaces    = CASE WHEN p_patch ? 'surfaces'
                           THEN COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(p_patch->'surfaces')), '{}')
                           ELSE surfaces END,
        categories  = CASE WHEN p_patch ? 'categories'
                           THEN COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(p_patch->'categories')), '{}')
                           ELSE categories END,
        level         = CASE WHEN p_patch ? 'level'         THEN p_patch->>'level'          ELSE level         END,
        default_rules = CASE WHEN p_patch ? 'default_rules' THEN default_rules || (p_patch->'default_rules') ELSE default_rules END,
        member_capacity  = CASE WHEN p_patch ? 'member_capacity'  THEN NULLIF(p_patch->>'member_capacity', '')::integer ELSE member_capacity END,
        waitlist_enabled = CASE WHEN p_patch ? 'waitlist_enabled' THEN (p_patch->>'waitlist_enabled')::boolean ELSE waitlist_enabled END,
        min_rating     = v_new_min,
        max_rating     = v_new_max,
        min_reputation = CASE WHEN p_patch ? 'min_reputation' THEN NULLIF(p_patch->>'min_reputation', '')::smallint ELSE min_reputation END,
        version    = version + 1,
        updated_at = now()
    WHERE id = p_league_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_before, payload_after)
    SELECT 'league', v_row.id, 'update', v_caller_id,
           jsonb_object_agg(t.k, to_jsonb(v_before) -> t.k),
           jsonb_object_agg(t.k, to_jsonb(v_row) -> t.k)
      FROM jsonb_object_keys(p_patch) AS t(k);

    RETURN v_row;

EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
    WHEN check_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_update(uuid, integer, jsonb) TO authenticated;

COMMENT ON FUNCTION public.league_update(uuid, integer, jsonb) IS
'Optimistic-locked jsonb patch on a league. default_rules is MERGED into the
stored object and validated by lt_assert_league_rules; every other key is
replaced. Seasons snapshot default_rules at creation, so a rules edit only
reaches seasons created after it.';
