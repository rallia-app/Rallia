-- ============================================
-- Leagues & Tournaments — invite link active until the bracket is published
-- ============================================
-- Product decision (co-founder): the shareable invite link stays active until
-- the organizer publishes the bracket — that, not "registration closed", is the
-- real cutoff for admitting new players. So an organizer can close public
-- self-registration yet still hand-pick late entrants by link, right up until
-- the bracket is generated.
--
-- Only the shareable-link redemption is widened here. Public self-registration
-- (tournament_register) still closes with the registration window, and the
-- in-app invite RPCs keep their registration_open gate. The window opens for the
-- link because it is entirely organizer-controlled: they mint, share and can
-- revoke it at will.
--
-- Same body as 20260612150000 with one change: the status gate now also admits
-- `registration_closed` as long as `bracket_locked_at IS NULL`. Capacity, link
-- validity, idempotency and lock ordering are all unchanged.
-- ============================================

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
    -- link-second (see 20260612150000 header: deadlock avoidance vs reset & register).
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

    -- Admission via the shareable link stays open until the bracket is published:
    -- registration_open, or registration_closed while no bracket exists yet.
    IF v_tournament.status NOT IN ('registration_open', 'registration_closed')
       OR v_tournament.bracket_locked_at IS NOT NULL THEN
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
    IS 'Registers the caller via a tournament invite token. Admits through registration_open AND registration_closed (until the bracket publishes); bypasses registration_mode; idempotent for already-active registrations. Spec: specs/17-leagues-tournaments/tournaments.md §Shareable invite links.';
