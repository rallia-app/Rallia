-- ============================================================================
-- Leagues — restore the suspension RPCs staging never received
-- ============================================================================
-- Staging drift found while smoke-testing 20260730120000 there:
-- league_suspend_member and league_reinstate_member did not exist on staging,
-- although their migration (20260628180000) is marked applied. The file gained
-- those two functions in an edit made AFTER staging had applied it — the
-- edited-applied-migration trap — so local (db:reset) and prod (CI applied the
-- final file) have them and staging alone does not. Verified 2026-07-30:
-- present on prod and local, absent on staging.
--
-- Without them, staging cannot create or manually lift a suspension at all,
-- which also makes the suspended-seat capacity rules (20260730120000) and the
-- lt-lift-suspensions cron (20260730100500) untestable there.
--
-- Both bodies are verbatim copies from 20260628180000. CREATE OR REPLACE makes
-- this a no-op everywhere the functions already exist.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- league_suspend_member: organizer suspends an active member
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_suspend_member(
    p_member_id   uuid,
    p_version_was integer,
    p_reason      text        DEFAULT NULL,
    p_until       timestamptz DEFAULT NULL
)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    league_members;
    v_league    leagues;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM league_members WHERE id = p_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_member.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_member.league_id;
    IF v_member.user_id = v_league.organizer_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_SUSPEND_ORGANIZER';
    END IF;
    IF v_member.user_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_SUSPEND_SELF';
    END IF;

    IF v_member.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_SUSPENDABLE';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    UPDATE league_members
       SET status           = 'suspended',
           suspended_at     = now(),
           suspended_until  = p_until,
           suspended_reason = p_reason,
           version          = version + 1,
           updated_at       = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'suspend_member', v_caller_id,
            jsonb_build_object('league_id', v_row.league_id, 'user_id', v_row.user_id,
                               'until', p_until, 'reason', p_reason));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_suspend_member(uuid, integer, text, timestamptz) TO authenticated;


-- ----------------------------------------------------------------------------
-- league_reinstate_member: organizer lifts a suspension (-> active)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_reinstate_member(
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

    SELECT * INTO v_member FROM league_members WHERE id = p_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_member.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_member.status <> 'suspended' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_SUSPENDED';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    UPDATE league_members
       SET status           = 'active',
           suspended_at     = NULL,
           suspended_until  = NULL,
           suspended_reason = NULL,
           version          = version + 1,
           updated_at       = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'reinstate_member', v_caller_id,
            jsonb_build_object('league_id', v_row.league_id, 'user_id', v_row.user_id));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_reinstate_member(uuid, integer) TO authenticated;
