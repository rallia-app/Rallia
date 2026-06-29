-- ============================================
-- Leagues & Tournaments — thread fee settings through create & update
-- ============================================
-- Lets organizers set entry fee, who-pays, payout timing and refund policy when
-- creating a tournament and edit them while it's still a draft. Fee fields are
-- locked once registration opens (players must see a stable price/refund policy
-- before paying), so they're only editable in 'draft'.
--
--   tournament_create : gains one optional `p_fee jsonb` param (cleaner than 7
--                       positional args). Adding a param changes the signature,
--                       so drop the old 18-arg overload first; re-grant after.
--   tournament_update : fee fields added to the per-field state gate + SET list.
-- ============================================


-- ---------------------------------------------------------------- create
-- Builds on the canonical 19-arg version (20260625120000, ending p_min_rating
-- numeric). Drop that overload before recreating with the extra p_fee param;
-- also drop any stray (…text, text, jsonb) overload from an earlier draft of
-- this migration so only one candidate remains.
DROP FUNCTION IF EXISTS public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text, numeric
);
DROP FUNCTION IF EXISTS public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text, jsonb
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
    p_fee               jsonb                         DEFAULT NULL
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
    v_recent_count  integer;
    v_closes_at     timestamptz;
    v_row           tournaments;
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
          FROM tournaments
         WHERE organizer_id = v_caller_id
           AND created_at  > now() - interval '24 hours';

        IF v_recent_count >= 5 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATE_LIMITED';
        END IF;
    END IF;

    IF p_match_format IS NULL THEN
        SELECT name INTO v_sport_name FROM sport WHERE id = p_sport_id;
        v_match_format := CASE v_sport_name
            WHEN 'pickleball' THEN 'pickleball_to_11'::match_format
            ELSE 'two_of_three'::match_format
        END;
    ELSE
        v_match_format := p_match_format;
    END IF;

    v_closes_at := COALESCE(
        p_registration_closes_at,
        GREATEST(p_start_date - interval '24 hours', now())
    );

    INSERT INTO tournaments (
        name, sport_id, max_participants, start_date, end_date,
        description, rules, logo_url, min_rating, visibility, registration_mode,
        bracket_type, match_format, entry_format,
        facility_id, venue_name, network_id,
        registration_opens_at, registration_closes_at,
        organizer_id,
        entry_fee_cents, currency, fee_payer, payout_timing,
        refund_policy_kind, refund_partial_bps, refund_cutoff_at
    )
    VALUES (
        p_name, p_sport_id, p_max_participants, p_start_date, p_end_date,
        p_description, p_rules, p_logo_url, p_min_rating, p_visibility, p_registration_mode,
        p_bracket_type, v_match_format, p_entry_format,
        p_facility_id, p_venue_name, p_network_id,
        p_registration_opens_at, v_closes_at,
        v_caller_id,
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
    uuid, text, uuid, timestamptz, timestamptz, text, text, numeric, jsonb
) TO authenticated;


-- ---------------------------------------------------------------- update
-- Body identical to 20260622120000 plus the fee fields in the per-field gate
-- and the UPDATE set. Fee fields are draft-only.
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
            WHEN 'min_rating'     THEN ARRAY['draft','registration_open']
            WHEN 'max_rating'     THEN ARRAY['draft','registration_open']
            WHEN 'min_reputation' THEN ARRAY['draft','registration_open']
            WHEN 'facility_id'   THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_name'    THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_address' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'max_participants'   THEN ARRAY['draft']
            WHEN 'bracket_type'       THEN ARRAY['draft']
            WHEN 'match_format'       THEN ARRAY['draft']
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

    IF p_patch ? 'entry_format' AND p_patch->>'entry_format' <> 'singles' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DOUBLES_NOT_SUPPORTED';
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
        min_rating     = CASE WHEN p_patch ? 'min_rating'     THEN (p_patch->>'min_rating')::numeric      ELSE min_rating     END,
        max_rating     = CASE WHEN p_patch ? 'max_rating'     THEN (p_patch->>'max_rating')::numeric      ELSE max_rating     END,
        min_reputation = CASE WHEN p_patch ? 'min_reputation' THEN (p_patch->>'min_reputation')::smallint ELSE min_reputation END,
        facility_id   = CASE WHEN p_patch ? 'facility_id'   THEN (p_patch->>'facility_id')::uuid ELSE facility_id   END,
        venue_name    = CASE WHEN p_patch ? 'venue_name'    THEN p_patch->>'venue_name'          ELSE venue_name    END,
        venue_address = CASE WHEN p_patch ? 'venue_address' THEN p_patch->>'venue_address'       ELSE venue_address END,
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
