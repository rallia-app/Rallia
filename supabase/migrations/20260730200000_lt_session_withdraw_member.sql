-- ============================================================================
-- Leagues — let the organizer withdraw a member from a session
-- ============================================================================
-- session_confirm_presence only ever acts on auth.uid(): its third argument is
-- p_partner_id, not a target. So nothing in the app could change someone else's
-- presence, and an organizer had no way to free a seat. Reported from staging
-- as "il m'etait impossible de retirer un joueur confirme pour en voir monter
-- un de la liste d'attente".
--
-- The promotion machinery already exists: tg_session_presence_promote_waitlist
-- fires on confirmed -> anything-else and pulls up the waitlist head. The only
-- missing piece was a door for the organizer, which is what this adds.
--
-- Deliberately narrow. It withdraws (confirmed or waitlisted -> declined) and
-- nothing else:
--   * it cannot seat someone. Confirming is the member's own decision, and on a
--     paid season it is payment that seats them (session_confirm_presence's
--     PAYMENT_REQUIRED gate), which an organizer must not be able to skip.
--   * it does not touch season_members. Withdrawing from one session is not
--     leaving the season.
--
-- Bookkeeping mirrors the decline path of session_confirm_presence exactly:
-- status, waitlist_position cleared, responded_at stamped, version bumped. That
-- matters because a stale waitlist_position on a declined row would corrupt the
-- queue ordering the promotion trigger reads.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.session_withdraw_member(
    p_session_id  uuid,
    p_user_id     uuid,
    p_version_was integer
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
    v_row       session_presence;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
    IF v_session.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_FOUND';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_session.season_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Same window the members themselves answer in. Once the sheet is generated
    -- the pairing owns who plays, and freeing a seat there would leave the sheet
    -- disagreeing with the roster.
    IF v_session.status <> 'published' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_PUBLISHED';
    END IF;

    SELECT * INTO v_existing
      FROM session_presence
     WHERE session_id = p_session_id AND user_id = p_user_id
     FOR UPDATE;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRESENCE_NOT_FOUND';
    END IF;

    IF v_existing.status NOT IN ('confirmed', 'waitlisted') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRESENCE_NOT_WITHDRAWABLE';
    END IF;

    UPDATE session_presence
       SET status            = 'declined',
           waitlist_position = NULL,
           responded_at      = now(),
           version           = version + 1,
           updated_at        = now()
     WHERE id = v_existing.id
       AND version = p_version_was
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    -- audit_scope has no presence member; the session is the entity and the
    -- affected member rides in the payload.
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session', p_session_id, 'organizer_withdraw', v_caller_id,
        jsonb_build_object(
            'presence_id', v_row.id,
            'user_id', p_user_id,
            'previous_status', v_existing.status
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_withdraw_member(uuid, uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.session_withdraw_member(uuid, uuid, integer) IS
    'Organizer/admin withdraws a member from a published session (confirmed or waitlisted -> declined), freeing a seat so tg_session_presence_promote_waitlist can pull up the waitlist head. Cannot seat anyone and does not touch season_members.';
