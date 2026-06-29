-- ============================================================================
-- Leagues — season enrollment RPCs  [free phase]
-- ============================================================================
-- Ships the write paths for the season_members roster (DDL in 20260629160000):
--   season_enroll          active league member enrolls in an open season
--   season_withdraw        self-withdraw from an open season
--   season_remove_member   organizer removes someone from the roster
--
-- All three mirror the league member-lifecycle RPCs (SECURITY DEFINER,
-- optimistic version lock, membership audit). Audit uses the existing
-- 'membership' scope with season_id in the payload.
--
-- Also CREATE OR REPLACE session_confirm_presence to idempotently auto-enroll
-- the caller on confirm. This makes season_members the canonical, self-
-- populating roster with no behaviour change for free leagues. Phase 4 flips
-- this auto-enroll to a paid gate for paid seasons; the rest is unchanged.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- season_enroll: an active league member enrolls in an open season
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.season_enroll(p_season_id uuid)
RETURNS season_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_season    seasons;
    v_existing  season_members;
    v_row       season_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    IF v_season.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    -- Enrollment requires standing in the league. The organizer/co-organizer
    -- (who may not be a league_members row) and admins are allowed too.
    IF NOT (
        public.is_league_organizer(v_season.league_id)
        OR public.is_admin()
        OR public.is_active_league_member(v_season.league_id)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_LEAGUE_MEMBER';
    END IF;

    SELECT * INTO v_existing
      FROM season_members
     WHERE season_id = p_season_id AND user_id = v_caller_id
     FOR UPDATE;

    -- Idempotent: already enrolled -> return as-is.
    IF v_existing.id IS NOT NULL AND v_existing.status = 'enrolled' THEN
        RETURN v_existing;
    END IF;

    IF v_existing.id IS NOT NULL THEN
        UPDATE season_members
           SET status       = 'enrolled',
               enrolled_at  = now(),
               withdrawn_at = NULL,
               version      = version + 1,
               updated_at   = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO season_members (season_id, user_id, status)
        VALUES (p_season_id, v_caller_id, 'enrolled')
        RETURNING * INTO v_row;
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'enroll', v_caller_id,
            jsonb_build_object('season_id', p_season_id, 'league_id', v_season.league_id));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_enroll(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- season_withdraw: caller withdraws from an open season
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.season_withdraw(p_season_id uuid)
RETURNS season_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_season    seasons;
    v_existing  season_members;
    v_row       season_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    -- Withdrawal only matters while the season is still open (mirrors the
    -- registration-open-only rule on tournament withdrawal). This is also the
    -- Phase 4 refund hook point.
    IF v_season.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    SELECT * INTO v_existing
      FROM season_members
     WHERE season_id = p_season_id AND user_id = v_caller_id
     FOR UPDATE;
    IF v_existing.id IS NULL OR v_existing.status NOT IN ('enrolled', 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ENROLLED';
    END IF;

    UPDATE season_members
       SET status       = 'withdrawn',
           withdrawn_at = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id = v_existing.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'withdraw', v_caller_id,
            jsonb_build_object('season_id', p_season_id, 'league_id', v_season.league_id,
                               'prev_status', v_existing.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_withdraw(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- season_remove_member: organizer removes a player from the season roster
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.season_remove_member(
    p_season_member_id uuid,
    p_version_was      integer
)
RETURNS season_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    season_members;
    v_season    seasons;
    v_row       season_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM season_members WHERE id = p_season_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_member.season_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_member.status NOT IN ('enrolled', 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_REMOVABLE';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    UPDATE season_members
       SET status       = 'withdrawn',
           withdrawn_at = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'remove_member', v_caller_id,
            jsonb_build_object('season_id', v_row.season_id, 'league_id', v_season.league_id,
                               'user_id', v_row.user_id, 'prev_status', v_member.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_remove_member(uuid, integer) TO authenticated;


-- ----------------------------------------------------------------------------
-- session_confirm_presence: unchanged behaviour + idempotent season auto-enroll
-- ----------------------------------------------------------------------------
-- Identical to 20260618120000 except for the marked auto-enroll block. A
-- confirm now ensures the caller is on the season roster; declines/resets do
-- not. For a free season this is a no-op the caller never sees; Phase 4 will
-- gate confirmation on a paid enrollment for paid seasons instead.
CREATE OR REPLACE FUNCTION public.session_confirm_presence(
    p_session_id uuid,
    p_status     session_presence_status,
    p_partner_id uuid DEFAULT NULL
)
RETURNS session_presence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_session   sessions;
    v_season    seasons;
    v_existing  session_presence;
    v_target    session_presence_status;
    v_confirmed integer;
    v_position  integer;
    v_row       session_presence;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_status NOT IN ('confirmed', 'declined', 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
    IF v_session.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_FOUND';
    END IF;

    IF v_session.status <> 'published' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_PUBLISHED';
    END IF;

    IF v_session.confirmation_deadline_at IS NOT NULL
       AND now() > v_session.confirmation_deadline_at THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIRMATION_CLOSED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_session.season_id;

    IF NOT public.is_active_league_member(v_season.league_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    -- >>> season roster auto-enroll (added 20260629160100) >>>
    -- Confirming presence puts the caller on the season roster. Idempotent: it
    -- never bumps an already-enrolled row, and re-enrolls a withdrawn one.
    IF p_status = 'confirmed' THEN
        INSERT INTO season_members (season_id, user_id, status)
        VALUES (v_session.season_id, v_caller_id, 'enrolled')
        ON CONFLICT (season_id, user_id) DO UPDATE
           SET status       = 'enrolled',
               enrolled_at  = now(),
               withdrawn_at = NULL,
               version      = season_members.version + 1,
               updated_at   = now()
         WHERE season_members.status <> 'enrolled';
    END IF;
    -- <<< season roster auto-enroll <<<

    SELECT * INTO v_existing
      FROM session_presence
     WHERE session_id = p_session_id AND user_id = v_caller_id;

    -- Capacity gate: a confirm past capacity goes to the waitlist (the caller's
    -- own current seat doesn't count against the cap).
    v_target := p_status;
    v_position := NULL;
    IF p_status = 'confirmed' AND v_session.capacity IS NOT NULL THEN
        SELECT count(*) INTO v_confirmed
          FROM session_presence
         WHERE session_id = p_session_id
           AND status = 'confirmed'
           AND user_id <> v_caller_id;

        IF v_confirmed >= v_session.capacity THEN
            v_target := 'waitlisted';
            SELECT COALESCE(max(waitlist_position), 0) + 1 INTO v_position
              FROM session_presence
             WHERE session_id = p_session_id AND status = 'waitlisted';
        END IF;
    END IF;

    IF v_existing.id IS NOT NULL THEN
        UPDATE session_presence
           SET status            = v_target,
               preferred_partner_id = p_partner_id,
               waitlist_position = v_position,
               responded_at      = now(),
               version           = version + 1,
               updated_at        = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO session_presence (
            session_id, user_id, status, preferred_partner_id,
            waitlist_position, responded_at
        )
        VALUES (
            p_session_id, v_caller_id, v_target, p_partner_id,
            v_position, now()
        )
        RETURNING * INTO v_row;
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_confirm_presence(uuid, session_presence_status, uuid)
    TO authenticated;

COMMIT;
