-- ============================================
-- Leagues & Tournaments — tournament invite link RPCs
-- ============================================
-- Spec: specs/17-leagues-tournaments/tournaments.md §Shareable invite links
--
-- tournament_invite_links (table + RLS shipped in 20260510165900/170001:
-- organizer-only SELECT, all direct writes blocked) finally gets its RPC
-- surface. MVP model: ONE rotating default link per tournament (label,
-- max_uses, expires_at stay NULL — multi-link-per-audience is a later
-- slice; redeem validates them anyway so future links Just Work).
--
--   tournament_invite_get_or_create  (organizer)  return/mint active link
--   tournament_invite_reset          (organizer)  revoke all + mint fresh
--   tournament_get_by_invite_token   (any auth)   token → tournament preview,
--                                                 bypasses RLS so PRIVATE
--                                                 tournaments render for
--                                                 invitees pre-registration
--   tournament_join_via_invite       (any auth)   register via token. Links
--                                                 BYPASS registration_mode
--                                                 (spec): status='registered'
--                                                 even on approval/invite_only.
--
-- tournament_join_via_invite mirrors tournament_register (20260612120000:
-- row lock, capacity, re-register-after-withdraw) with one deliberate
-- divergence: an already-active registration RETURNS the existing row
-- instead of raising ALREADY_REGISTERED — invite taps must be idempotent
-- (double-tap, re-tap of an old message).
--
-- Lock ordering: tournament row FIRST, then link row — tournament_register
-- and the reset RPC also lock the tournament first, so join/reset/register
-- can't deadlock.
-- ============================================


-- =====================
-- tournament_invite_get_or_create
-- =====================

CREATE OR REPLACE FUNCTION public.tournament_invite_get_or_create(
    p_tournament_id uuid
)
RETURNS tournament_invite_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_tournament  tournaments;
    v_row         tournament_invite_links;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Lock the tournament row to serialize concurrent get-or-create calls
    -- (two devices opening the share sheet at once must yield one link).
    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_TERMINAL';
    END IF;

    SELECT * INTO v_row
      FROM tournament_invite_links
     WHERE tournament_id = p_tournament_id
       AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_row.id IS NOT NULL THEN
        RETURN v_row;
    END IF;

    INSERT INTO tournament_invite_links (tournament_id, token, created_by)
    VALUES (p_tournament_id, replace(gen_random_uuid()::text, '-', ''), v_caller_id)
    RETURNING * INTO v_row;

    -- Token deliberately excluded from the audit payload.
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', p_tournament_id, 'invite_link_created', v_caller_id,
        jsonb_build_object('link_id', v_row.id)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_invite_get_or_create(uuid) TO authenticated;

COMMENT ON FUNCTION public.tournament_invite_get_or_create(uuid)
    IS 'Returns the tournament''s active default invite link, minting one if absent. Organizer/admin only. Spec: specs/17-leagues-tournaments/tournaments.md §Shareable invite links.';


-- =====================
-- tournament_invite_reset
-- =====================

CREATE OR REPLACE FUNCTION public.tournament_invite_reset(
    p_tournament_id uuid
)
RETURNS tournament_invite_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_tournament  tournaments;
    v_row         tournament_invite_links;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_TERMINAL';
    END IF;

    UPDATE tournament_invite_links
       SET revoked_at = now()
     WHERE tournament_id = p_tournament_id
       AND revoked_at IS NULL;

    INSERT INTO tournament_invite_links (tournament_id, token, created_by)
    VALUES (p_tournament_id, replace(gen_random_uuid()::text, '-', ''), v_caller_id)
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', p_tournament_id, 'invite_link_reset', v_caller_id,
        jsonb_build_object('new_link_id', v_row.id)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_invite_reset(uuid) TO authenticated;

COMMENT ON FUNCTION public.tournament_invite_reset(uuid)
    IS 'Revokes the tournament''s active invite link(s) and mints a fresh one. Organizer/admin only.';


-- =====================
-- tournament_get_by_invite_token
-- =====================
-- Preview for invitees: a valid token reveals the tournament row even when
-- RLS would hide it (private tournament, caller not yet registered), plus
-- the active registration count (treg_select hides other players' rows on
-- private tournaments, so the client can't compute spots-left itself).
-- One opaque INVITE_INVALID for every failure mode — don't leak whether a
-- token exists, was revoked, or expired.

CREATE OR REPLACE FUNCTION public.tournament_get_by_invite_token(
    p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_link        tournament_invite_links;
    v_tournament  tournaments;
    v_count       integer;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_link FROM tournament_invite_links WHERE token = p_token;
    IF v_link.id IS NULL
       OR v_link.revoked_at IS NOT NULL
       OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
       OR (v_link.max_uses IS NOT NULL AND v_link.uses >= v_link.max_uses) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_link.tournament_id;
    IF v_tournament.id IS NULL OR v_tournament.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT count(*) INTO v_count
      FROM tournament_registrations
     WHERE tournament_id = v_tournament.id
       AND status IN ('registered', 'pending');

    RETURN jsonb_build_object(
        'tournament', to_jsonb(v_tournament),
        'active_count', v_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_get_by_invite_token(text) TO authenticated;

COMMENT ON FUNCTION public.tournament_get_by_invite_token(text)
    IS 'Invite-token preview: returns {tournament, active_count} for a valid token, bypassing RLS so invitees can see private tournaments before registering.';


-- =====================
-- tournament_join_via_invite
-- =====================

CREATE OR REPLACE FUNCTION public.tournament_join_via_invite(
    p_token text
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id     uuid := auth.uid();
    v_tournament_id uuid;
    v_tournament    tournaments;
    v_link          tournament_invite_links;
    v_active_count  integer;
    v_existing      tournament_registrations;
    v_row           tournament_registrations;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Resolve the tournament WITHOUT locking, then lock tournament-first /
    -- link-second (see header: deadlock avoidance vs reset & register).
    SELECT tournament_id INTO v_tournament_id
      FROM tournament_invite_links WHERE token = p_token;
    IF v_tournament_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    -- Re-validate the link under lock: a reset that committed while we
    -- waited surfaces here as INVITE_INVALID.
    SELECT * INTO v_link FROM tournament_invite_links WHERE token = p_token FOR UPDATE;
    IF v_link.id IS NULL
       OR v_link.revoked_at IS NOT NULL
       OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
       OR (v_link.max_uses IS NOT NULL AND v_link.uses >= v_link.max_uses)
       OR v_tournament.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    PERFORM public.assert_caller_plays_sport(v_tournament.sport_id);

    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = v_tournament.id
       AND user_id       = v_caller_id;

    -- Idempotent re-tap: already active → hand back the existing row
    -- (deliberate divergence from tournament_register's ALREADY_REGISTERED).
    IF v_existing.id IS NOT NULL
       AND v_existing.status IN ('registered', 'pending', 'waitlisted') THEN
        RETURN v_existing;
    END IF;

    SELECT count(*) INTO v_active_count
      FROM tournament_registrations
     WHERE tournament_id = v_tournament.id
       AND status IN ('registered', 'pending');

    IF v_active_count >= v_tournament.max_participants THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    IF v_existing.id IS NOT NULL THEN
        -- Reactivate a withdrawn / disqualified row (mirrors 20260612120000).
        UPDATE tournament_registrations
           SET status        = 'registered',
               withdrawn_at  = NULL,
               approved_at   = now(),
               version       = version + 1,
               updated_at    = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        BEGIN
            INSERT INTO tournament_registrations (tournament_id, user_id, status)
            VALUES (v_tournament.id, v_caller_id, 'registered')
            RETURNING * INTO v_row;
        EXCEPTION WHEN unique_violation THEN
            -- Concurrent double-tap: the other call won; return its row.
            SELECT * INTO v_row
              FROM tournament_registrations
             WHERE tournament_id = v_tournament.id
               AND user_id       = v_caller_id;
            RETURN v_row;
        END;
    END IF;

    UPDATE tournament_invite_links SET uses = uses + 1 WHERE id = v_link.id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'register_via_invite', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_tournament.id,
            'link_id', v_link.id,
            'previous_status', v_existing.status,
            'status', v_row.status
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_join_via_invite(text) TO authenticated;

COMMENT ON FUNCTION public.tournament_join_via_invite(text)
    IS 'Registers the caller via a tournament invite token. Bypasses registration_mode (status=registered even on approval/invite_only tournaments); idempotent for already-active registrations. Spec: specs/17-leagues-tournaments/tournaments.md §Shareable invite links.';
