-- ============================================================================
-- Leagues — added seats drain the waitlist instead of going to walk-ins
-- ============================================================================
-- Promotion only fired on a member's departure, so an organizer raising
-- member_capacity (or removing the cap) opened seats that the queue never saw:
-- probe-confirmed that a walk-in joining right after a capacity raise landed
-- 'active' while the queue head kept waiting. A club that adds seats admits
-- its waitlist first.
--
-- The promotion body moves into lt_league_promote_waitlist_head, which seats
-- at most one eligible queue head per call and reports whether it did. The
-- departure trigger calls it once (a departure frees one seat); league_update
-- and league_resume drain it in a loop, so any patch that opens seats —
-- raising the cap, removing it, or resuming a league whose cap was raised
-- while paused — admits every queued player a seat now exists for.
--
-- Two deliberate semantics, one of them a change:
--   * capacity NULL now counts as seats-for-everyone. The old trigger bailed
--     on a NULL cap (nothing queues while uncapped, so departures had nobody
--     to serve); the drain path is exactly the case where rows queued under a
--     cap that has since been removed, and they should all come in.
--   * waitlist_enabled is not consulted. The flag governs whether NEW joiners
--     queue (league_join); a player already queued is owed a seat even if the
--     organizer has since toggled the flag off.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_league_promote_waitlist_head(p_league_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_league    leagues;
    v_seated    integer;
    v_next      league_member_waitlist;
    v_status    league_member_status;
BEGIN
    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
    IF v_league.id IS NULL OR v_league.status <> 'active' THEN
        RETURN false;
    END IF;

    IF v_league.member_capacity IS NOT NULL THEN
        SELECT count(*) INTO v_seated
          FROM league_members
         WHERE league_id = p_league_id AND status IN ('active', 'suspended');
        IF v_seated >= v_league.member_capacity THEN
            RETURN false;
        END IF;
    END IF;

    -- Head of the queue, but only someone still waiting: their membership must
    -- still be the 'pending' hold league_join wrote when it queued them.
    SELECT w.* INTO v_next
      FROM league_member_waitlist w
      JOIN league_members lm
        ON lm.league_id = w.league_id AND lm.user_id = w.user_id
     WHERE w.league_id = p_league_id AND w.promoted_at IS NULL
       AND lm.status = 'pending'
     ORDER BY w.position ASC, w.joined_at ASC
     LIMIT 1
     FOR UPDATE OF w SKIP LOCKED;
    IF v_next.id IS NULL THEN
        RETURN false;
    END IF;

    v_status := CASE WHEN v_league.join_mode = 'open' THEN 'active' ELSE 'pending' END;

    INSERT INTO league_members (league_id, user_id, role, status, approved_at)
    VALUES (p_league_id, v_next.user_id, 'member', v_status,
            CASE WHEN v_status = 'active' THEN now() ELSE NULL END)
    ON CONFLICT (league_id, user_id) DO UPDATE
       SET status      = v_status,
           approved_at = CASE WHEN v_status = 'active' THEN now() ELSE NULL END,
           left_at     = NULL,
           version     = league_members.version + 1,
           updated_at  = now();

    UPDATE league_member_waitlist SET promoted_at = now() WHERE id = v_next.id;

    -- No notification here: on an open league the pending -> active flip above
    -- already fires notify_league_membership_change's "you're in" branch. On
    -- approval / invite_only the row stays 'pending' and the organizer was
    -- already told when it was first created.

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', p_league_id, 'waitlist_promote', auth.uid(),
            jsonb_build_object('league_id', p_league_id, 'user_id', v_next.user_id,
                               'status', v_status));

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.lt_league_promote_waitlist_head(uuid) IS
'Seats at most one eligible waitlist head (membership still the pending hold)
when the league is active and a seat is free (NULL capacity = unlimited).
Returns whether it promoted. Called once per departure by the membership
trigger and in a loop by league_update / league_resume.';


-- The departure trigger delegates to the helper (one seat per departure).
CREATE OR REPLACE FUNCTION public.tg_league_member_promote_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.lt_league_promote_waitlist_head(NEW.league_id);
    RETURN NULL;
END;
$$;


-- league_update: unchanged body (20260716180000) plus the drain loop.
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

    -- A patch may have opened seats (capacity raised or removed): the queue
    -- gets them before any walk-in can. No-ops instantly when nothing changed.
    WHILE public.lt_league_promote_waitlist_head(p_league_id) LOOP
    END LOOP;

    SELECT * INTO v_row FROM leagues WHERE id = p_league_id;
    RETURN v_row;

EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
    WHEN check_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_update(uuid, integer, jsonb) TO authenticated;


-- league_resume: unchanged body (20260716190000) plus the drain, so a cap
-- raised while paused seats its queue the moment the league is live again.
CREATE OR REPLACE FUNCTION public.league_resume(
    p_league_id   uuid,
    p_version_was integer
)
RETURNS leagues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       leagues;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_league_organizer(p_league_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Only paused resumes. A closed league is terminal (no reopen path by design).
    UPDATE leagues
       SET status     = 'active',
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_league_id
       AND version = p_version_was
       AND status  = 'paused'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_PAUSED';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('league', v_row.id, 'resume', v_caller_id,
            jsonb_build_object('status', v_row.status));

    WHILE public.lt_league_promote_waitlist_head(p_league_id) LOOP
    END LOOP;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_resume(uuid, integer) TO authenticated;
