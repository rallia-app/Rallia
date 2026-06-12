-- ============================================
-- Leagues & Tournaments — tournament_update RPC
-- ============================================
-- Spec: specs/17-leagues-tournaments/tournaments.md §Editable fields by state
--
-- Partial update via jsonb patch: keys present in p_patch are applied, keys
-- absent are untouched (a json null clears a nullable column). Each key is
-- gated on the tournament's current status per the spec matrix. Optimistic
-- locking via p_version_was.
--
-- Out of scope (later slices): participant notifications on impactful
-- changes, rating-gate grandfathering, network_id changes.
-- ============================================

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

    -- Per-field state gates (spec §Editable fields by state).
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        v_allowed := CASE v_key
            WHEN 'name'        THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'description' THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
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
            ELSE NULL
        END;

        IF v_allowed IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UNKNOWN_FIELD:' || v_key;
        END IF;
        IF NOT (v_before.status::text = ANY (v_allowed)) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FIELD_NOT_EDITABLE:' || v_key;
        END IF;
    END LOOP;

    -- Clean error codes ahead of the table CHECKs.
    IF p_patch ? 'name' AND (p_patch->>'name' IS NULL
        OR char_length(trim(p_patch->>'name')) NOT BETWEEN 1 AND 100) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_NAME';
    END IF;

    IF p_patch ? 'max_participants'
        AND (p_patch->>'max_participants')::smallint NOT IN (4, 8, 16, 32, 64, 128) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_MAX_PARTICIPANTS';
    END IF;

    -- Doubles still blocked end-to-end (see 20260527000300).
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
        version    = version + 1,
        updated_at = now()
    WHERE id = p_tournament_id
    RETURNING * INTO v_row;

    -- Audit only the touched keys, before/after.
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

COMMENT ON FUNCTION public.tournament_update(uuid, integer, jsonb)
    IS 'Organizer partial-update of a tournament via jsonb patch, gated per the editable-fields-by-state matrix. SECURITY DEFINER: bypasses RLS to write the audit row. Spec: specs/17-leagues-tournaments/tournaments.md.';
