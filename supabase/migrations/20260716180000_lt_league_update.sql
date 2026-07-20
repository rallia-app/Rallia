-- League edit (V6 gap): organizers had no way to change a league after creation.
--
-- Mirrors tournament_update (20260708120000): optimistic-locked jsonb patch, a
-- per-field allowed-status map, and an audit row carrying only the patched keys.
--
-- Divergence from tournaments: league_status is ('active','paused','closed') with
-- no draft, so there is no structure-freeze tier — every editable field is open in
-- active/paused and nothing is editable once closed. sport_id/organizer_id/status
-- are deliberately absent from the map: sport_id seeds default_rules at create,
-- and status belongs to the lifecycle RPCs, not a patch.
--
-- default_rules stays editable in both states because season_create snapshots it
-- (20260615120000:441) — an edit only reaches seasons created afterwards, never a
-- season whose rules are already frozen.

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

    IF p_patch ? 'default_rules' AND jsonb_typeof(p_patch->'default_rules') <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
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
        default_rules = CASE WHEN p_patch ? 'default_rules' THEN p_patch->'default_rules'   ELSE default_rules END,
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
