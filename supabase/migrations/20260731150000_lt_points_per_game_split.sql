-- ============================================================================
-- Scoring — how many games, and how many points, stop being one setting
-- ============================================================================
-- match_format fused two independent things. For tennis its labels state how
-- many SETS win a match (one_set / two_of_three / three_of_five). For
-- pickleball they stated how many POINTS win a single GAME (to 11 / 15 / 21)
-- and said nothing about how many games are played, so best-of-3 to 11 — the
-- standard format — was unreachable: picking "to 11" pinned the event at
-- exactly one game. Reported as "en pickleball on joue 2 de 3 a 11 points, je
-- ne peux pas le dire".
--
-- The axes are split:
--
--   * match_format now means games/sets-to-win for BOTH sports. Pickleball uses
--     the same one_set / two_of_three / three_of_five labels tennis does.
--   * points_per_game (11 / 15 / 21) carries the target for pickleball. NULL
--     for tennis, whose target is games_per_set.
--
-- Postgres cannot drop an enum value, so pickleball_to_11 / _15 / _21 stay in
-- match_format. Nothing writes them any more: tournament_create splits a fused
-- value it is handed rather than rejecting it, so an un-updated client keeps
-- working and still lands a clean pair of columns. Existing rows are migrated
-- below (prod holds none, staging a handful).
-- ============================================================================

ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS points_per_game smallint;
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS points_per_game smallint;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.tournaments'::regclass
                      AND conname = 'tournaments_points_per_game_check') THEN
        ALTER TABLE public.tournaments
            ADD CONSTRAINT tournaments_points_per_game_check
            CHECK (points_per_game IS NULL OR points_per_game IN (11, 15, 21));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.sessions'::regclass
                      AND conname = 'sessions_points_per_game_check') THEN
        ALTER TABLE public.sessions
            ADD CONSTRAINT sessions_points_per_game_check
            CHECK (points_per_game IS NULL OR points_per_game IN (11, 15, 21));
    END IF;
END $$;

COMMENT ON COLUMN public.tournaments.points_per_game IS
'Points that win one pickleball game (11/15/21). NULL for tennis, whose target
is games_per_set. Pairs with match_format, which counts games/sets to win.';
COMMENT ON COLUMN public.sessions.points_per_game IS
'Points that win one pickleball game (11/15/21). NULL for tennis.';

-- Backfill: a fused label becomes best-of-3 at the target it named. Best-of-3
-- rather than one_set because that is the format those events were actually
-- playing — the single-game cap was the bug, not the intent.
UPDATE public.tournaments
   SET points_per_game = CASE match_format
                             WHEN 'pickleball_to_11' THEN 11::smallint
                             WHEN 'pickleball_to_15' THEN 15::smallint
                             ELSE 21::smallint END,
       match_format    = 'two_of_three'::match_format
 WHERE match_format IN ('pickleball_to_11', 'pickleball_to_15', 'pickleball_to_21');

UPDATE public.sessions
   SET points_per_game = CASE match_format
                             WHEN 'pickleball_to_11' THEN 11::smallint
                             WHEN 'pickleball_to_15' THEN 15::smallint
                             ELSE 21::smallint END,
       match_format    = 'two_of_three'::match_format
 WHERE match_format IN ('pickleball_to_11', 'pickleball_to_15', 'pickleball_to_21');


-- ---------------------------------------------------------------- create
-- Same body as 20260725120000 plus p_points_per_game (appended, so existing
-- named-arg callers are unaffected) and the fused-label split above. Adding a
-- param changes the signature → drop the 24-arg overload first, re-grant after.
DROP FUNCTION IF EXISTS public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text, numeric, jsonb,
    text, text, integer, numeric
);

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
    p_points_per_game   smallint                      DEFAULT NULL
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
    v_row           tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    PERFORM public.assert_caller_plays_sport(p_sport_id);

    -- Explicit, before the table CHECK fires: check_violation below is mapped
    -- to INVALID_FEE_SETTINGS, which would be a lie here.
    IF p_min_rating IS NOT NULL AND p_max_rating IS NOT NULL
       AND p_max_rating < p_min_rating THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RATING_RANGE';
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

    -- The two axes are independent now. A caller who still passes one of the
    -- legacy fused labels gets it split here rather than rejected, so older
    -- clients keep working and never write a fused value again.
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

    -- Pickleball needs a target; best-of-3 to 11 is the standard.
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


GRANT EXECUTE ON FUNCTION public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text, numeric, jsonb,
    text, text, integer, numeric, smallint
) TO authenticated;
-- ---------------------------------------------------------------- update
-- Same body as 20260725120000 plus points_per_game: draft-only (it shapes the
-- scoring, exactly like match_format) and validated to 11/15/21.
-- Same body as 20260716210000 with two changes: max_rating joins min_rating in
-- the draft-only lock, and the resulting band is validated.
CREATE OR REPLACE FUNCTION public.tournament_update(
    p_tournament_id uuid,
    p_version_was   integer,
    p_patch         jsonb
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_before      tournaments;
    v_row         tournaments;
    v_key         text;
    v_allowed     text[];
    v_sport_name  text;
    v_new_start   timestamptz;
    v_new_end     timestamptz;
    v_new_format  match_format;
    v_new_min     numeric;
    v_new_max     numeric;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPTY_PATCH';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_before FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_before.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF v_before.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    IF v_before.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_TERMINAL';
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        v_allowed := CASE v_key
            WHEN 'name'        THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'description' THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'rules'       THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'logo_url'    THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'visibility'  THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'surface'     THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'level'       THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'categories'  THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'registration_mode'      THEN ARRAY['draft','registration_open']
            WHEN 'registration_opens_at'  THEN ARRAY['draft','registration_open']
            WHEN 'registration_closes_at' THEN ARRAY['draft','registration_open']
            WHEN 'start_date'  THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'end_date'    THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            -- The rating band locks at draft: it is a competitive fact about
            -- the field (and min_rating is a scoring input), so neither bound
            -- can move once players have entered on the strength of it.
            WHEN 'min_rating'     THEN ARRAY['draft']
            WHEN 'max_rating'     THEN ARRAY['draft']
            WHEN 'min_reputation' THEN ARRAY['draft','registration_open']
            WHEN 'facility_id'   THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_name'    THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_address' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'city'          THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'prize_money_cents' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'max_participants'   THEN ARRAY['draft']
            WHEN 'bracket_type'       THEN ARRAY['draft']
            WHEN 'match_format'       THEN ARRAY['draft']
            WHEN 'points_per_game'    THEN ARRAY['draft']
            WHEN 'games_per_set'      THEN ARRAY['draft']
            WHEN 'final_set_tiebreak' THEN ARRAY['draft']
            WHEN 'entry_format'       THEN ARRAY['draft']
            -- Fee settings: lockable only before registration opens.
            WHEN 'entry_fee_cents'    THEN ARRAY['draft']
            WHEN 'currency'           THEN ARRAY['draft']
            WHEN 'fee_payer'          THEN ARRAY['draft']
            WHEN 'payout_timing'      THEN ARRAY['draft']
            WHEN 'refund_policy_kind' THEN ARRAY['draft']
            WHEN 'refund_partial_bps' THEN ARRAY['draft']
            WHEN 'refund_cutoff_at'   THEN ARRAY['draft']
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

    IF p_patch ? 'max_participants'
        AND (p_patch->>'max_participants')::smallint NOT IN (4, 8, 16, 32, 64, 128) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_MAX_PARTICIPANTS';
    END IF;

    -- The target is a pickleball setting; the CHECK would reject anything else
    -- anyway, but check_violation here maps to INVALID_FEE_SETTINGS downstream.
    IF p_patch ? 'points_per_game'
       AND p_patch->>'points_per_game' IS NOT NULL
       AND (p_patch->>'points_per_game')::smallint NOT IN (11, 15, 21) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_POINTS_PER_GAME';
    END IF;

    IF p_patch ? 'entry_format' AND p_patch->>'entry_format' <> 'singles' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DOUBLES_NOT_SUPPORTED';
    END IF;

    -- Band validity is checked against the merged result: a patch touching only
    -- one bound still has to sit right against the stored other one.
    IF p_patch ? 'min_rating' OR p_patch ? 'max_rating' THEN
        v_new_min := CASE WHEN p_patch ? 'min_rating' THEN (p_patch->>'min_rating')::numeric ELSE v_before.min_rating END;
        v_new_max := CASE WHEN p_patch ? 'max_rating' THEN (p_patch->>'max_rating')::numeric ELSE v_before.max_rating END;
        IF v_new_min IS NOT NULL AND v_new_max IS NOT NULL AND v_new_max < v_new_min THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RATING_RANGE';
        END IF;
    END IF;

    v_new_start := CASE WHEN p_patch ? 'start_date' THEN (p_patch->>'start_date')::timestamptz ELSE v_before.start_date END;
    v_new_end   := CASE WHEN p_patch ? 'end_date'   THEN (p_patch->>'end_date')::timestamptz   ELSE v_before.end_date   END;
    IF v_new_start IS NULL OR v_new_end IS NULL OR v_new_end < v_new_start THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DATES';
    END IF;

    IF p_patch ? 'match_format' THEN
        v_new_format := (p_patch->>'match_format')::match_format;
        SELECT name INTO v_sport_name FROM sport WHERE id = v_before.sport_id;
        IF (v_sport_name = 'pickleball') <> (v_new_format::text LIKE 'pickleball%') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_FORMAT_SPORT_MISMATCH';
        END IF;
    END IF;

    UPDATE tournaments SET
        name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')   ELSE name        END,
        description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description'  ELSE description END,
        rules       = CASE WHEN p_patch ? 'rules'       THEN p_patch->>'rules'        ELSE rules       END,
        logo_url    = CASE WHEN p_patch ? 'logo_url'    THEN p_patch->>'logo_url'     ELSE logo_url    END,
        visibility  = CASE WHEN p_patch ? 'visibility'  THEN (p_patch->>'visibility')::tournament_visibility ELSE visibility END,
        surface     = CASE WHEN p_patch ? 'surface'     THEN p_patch->>'surface'      ELSE surface     END,
        level       = CASE WHEN p_patch ? 'level'       THEN p_patch->>'level'        ELSE level       END,
        categories  = CASE WHEN p_patch ? 'categories'
                           THEN COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(p_patch->'categories')), '{}')
                           ELSE categories END,
        registration_mode      = CASE WHEN p_patch ? 'registration_mode'      THEN (p_patch->>'registration_mode')::tournament_registration_mode ELSE registration_mode END,
        registration_opens_at  = CASE WHEN p_patch ? 'registration_opens_at'  THEN (p_patch->>'registration_opens_at')::timestamptz  ELSE registration_opens_at  END,
        registration_closes_at = CASE WHEN p_patch ? 'registration_closes_at' THEN (p_patch->>'registration_closes_at')::timestamptz ELSE registration_closes_at END,
        start_date  = v_new_start,
        end_date    = v_new_end,
        points_per_game = CASE WHEN p_patch ? 'points_per_game'
                               THEN (p_patch->>'points_per_game')::smallint
                               ELSE points_per_game END,
        min_rating     = CASE WHEN p_patch ? 'min_rating'     THEN (p_patch->>'min_rating')::numeric      ELSE min_rating     END,
        max_rating     = CASE WHEN p_patch ? 'max_rating'     THEN (p_patch->>'max_rating')::numeric      ELSE max_rating     END,
        min_reputation = CASE WHEN p_patch ? 'min_reputation' THEN (p_patch->>'min_reputation')::smallint ELSE min_reputation END,
        facility_id   = CASE WHEN p_patch ? 'facility_id'   THEN (p_patch->>'facility_id')::uuid ELSE facility_id   END,
        venue_name    = CASE WHEN p_patch ? 'venue_name'    THEN p_patch->>'venue_name'          ELSE venue_name    END,
        venue_address = CASE WHEN p_patch ? 'venue_address' THEN p_patch->>'venue_address'       ELSE venue_address END,
        city          = CASE WHEN p_patch ? 'city'          THEN p_patch->>'city'                ELSE city          END,
        prize_money_cents = CASE WHEN p_patch ? 'prize_money_cents' THEN (p_patch->>'prize_money_cents')::integer ELSE prize_money_cents END,
        max_participants   = CASE WHEN p_patch ? 'max_participants'   THEN (p_patch->>'max_participants')::smallint ELSE max_participants END,
        bracket_type       = CASE WHEN p_patch ? 'bracket_type'       THEN (p_patch->>'bracket_type')::bracket_type ELSE bracket_type END,
        match_format       = CASE WHEN p_patch ? 'match_format'       THEN v_new_format ELSE match_format END,
        games_per_set      = CASE WHEN p_patch ? 'games_per_set'      THEN (p_patch->>'games_per_set')::smallint ELSE games_per_set END,
        final_set_tiebreak = CASE WHEN p_patch ? 'final_set_tiebreak' THEN (p_patch->>'final_set_tiebreak')::final_set_tiebreak ELSE final_set_tiebreak END,
        entry_format       = CASE WHEN p_patch ? 'entry_format'       THEN (p_patch->>'entry_format')::entry_format ELSE entry_format END,
        entry_fee_cents    = CASE WHEN p_patch ? 'entry_fee_cents'    THEN (p_patch->>'entry_fee_cents')::integer ELSE entry_fee_cents END,
        currency           = CASE WHEN p_patch ? 'currency'           THEN p_patch->>'currency' ELSE currency END,
        fee_payer          = CASE WHEN p_patch ? 'fee_payer'          THEN (p_patch->>'fee_payer')::fee_payer_enum ELSE fee_payer END,
        payout_timing      = CASE WHEN p_patch ? 'payout_timing'      THEN (p_patch->>'payout_timing')::payout_timing_enum ELSE payout_timing END,
        refund_policy_kind = CASE WHEN p_patch ? 'refund_policy_kind' THEN (p_patch->>'refund_policy_kind')::refund_policy_kind_enum ELSE refund_policy_kind END,
        refund_partial_bps = CASE WHEN p_patch ? 'refund_partial_bps' THEN (p_patch->>'refund_partial_bps')::integer ELSE refund_partial_bps END,
        refund_cutoff_at   = CASE WHEN p_patch ? 'refund_cutoff_at'   THEN NULLIF(p_patch->>'refund_cutoff_at', '')::timestamptz ELSE refund_cutoff_at END,
        version    = version + 1,
        updated_at = now()
    WHERE id = p_tournament_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_before, payload_after)
    SELECT 'tournament', v_row.id, 'update', v_caller_id,
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

GRANT EXECUTE ON FUNCTION public.tournament_update(uuid, integer, jsonb) TO authenticated;
