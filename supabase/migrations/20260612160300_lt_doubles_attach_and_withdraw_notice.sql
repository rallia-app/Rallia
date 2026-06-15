-- ============================================
-- Doubles tournaments — attach a real doubles game + withdraw notice
-- ============================================
-- Completes the doubles flow started in 20260612160200:
--
--   1. tournament_attach_match (body from 20260510170010) accepts doubles:
--      the linked game must have format='doubles' and its four joined
--      participants must be exactly the two entries' pairs. Singles brackets
--      now also require format='singles' (closes a latent hole: a 2-joined
--      doubles-format game could previously attach to a singles bracket).
--      New error code: MATCH_FORMAT_MISMATCH.
--   2. lt_propagate_match_result_to_bracket resolves the winner registration
--      from the slot's own two registrations by captain OR partner — the
--      sampled winning player can be either pair member.
--   3. tournament_withdraw (body from 20260612160200) notifies the other
--      pair member (tournament_partner_withdrew).
-- ============================================


-- =====================
-- 1. tournament_attach_match — doubles-aware participant matching
-- =====================

CREATE OR REPLACE FUNCTION public.tournament_attach_match(
    p_tournament_match_id uuid,
    p_match_id            uuid
)
RETURNS tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_tm          tournament_matches;
    v_t           tournaments;
    v_is_doubles  boolean;
    v_match       match;
    v_p1_user     uuid;
    v_p1_partner  uuid;
    v_p2_user     uuid;
    v_p2_partner  uuid;
    v_expected    uuid[];
    v_mr          match_result;
    v_match_users uuid[];
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id FOR UPDATE;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_MATCH_NOT_FOUND';
    END IF;
    IF v_tm.match_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_LINKED';
    END IF;
    IF v_tm.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_PENDING';
    END IF;
    IF v_tm.player1_is_bye OR v_tm.player2_is_bye
       OR v_tm.player1_registration_id IS NULL
       OR v_tm.player2_registration_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_PENDING';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    IF v_t.status NOT IN ('in_progress', 'registration_closed') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_IN_PROGRESS';
    END IF;

    -- Expected players: both entries' members (captain + partner for doubles).
    SELECT user_id, partner_user_id INTO v_p1_user, v_p1_partner
      FROM tournament_registrations WHERE id = v_tm.player1_registration_id;
    SELECT user_id, partner_user_id INTO v_p2_user, v_p2_partner
      FROM tournament_registrations WHERE id = v_tm.player2_registration_id;

    v_is_doubles := v_t.entry_format <> 'singles';
    IF v_is_doubles THEN
        IF v_p1_partner IS NULL OR v_p2_partner IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTICIPANTS_MISMATCH';
        END IF;
        v_expected := ARRAY[v_p1_user, v_p1_partner, v_p2_user, v_p2_partner];
    ELSE
        v_expected := ARRAY[v_p1_user, v_p2_user];
    END IF;

    -- The caller must be one of the expected players
    IF NOT (v_caller_id = ANY(v_expected)) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_PARTICIPANT';
    END IF;

    -- The match must exist, match the tournament's sport and entry format,
    -- and not already be attached to another tournament_match.
    SELECT * INTO v_match FROM match WHERE id = p_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;
    IF v_match.sport_id <> v_t.sport_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SPORT_MISMATCH';
    END IF;
    IF COALESCE(v_match.format::text, 'singles')
       <> (CASE WHEN v_is_doubles THEN 'doubles' ELSE 'singles' END) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_FORMAT_MISMATCH';
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE match_id = p_match_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
    END IF;

    -- The match's joined participants must be exactly the expected players.
    SELECT array_agg(player_id ORDER BY player_id) INTO v_match_users
      FROM match_participant
     WHERE match_id = p_match_id AND status = 'joined';

    IF v_match_users IS NULL
       OR v_match_users <> (SELECT array_agg(u ORDER BY u) FROM unnest(v_expected) u) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTICIPANTS_MISMATCH';
    END IF;

    -- The match must have a verified result.
    SELECT * INTO v_mr
      FROM match_result
     WHERE match_id = p_match_id AND is_verified = true
     LIMIT 1;
    IF v_mr.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_VERIFIED';
    END IF;

    -- Attach
    UPDATE tournament_matches
       SET match_id   = p_match_id,
           updated_at = now()
     WHERE id = p_tournament_match_id
    RETURNING * INTO v_tm;

    -- Drive the bracket update + propagation
    PERFORM public.lt_propagate_match_result_to_bracket(v_mr.id);

    RETURN v_tm;
END;
$$;


-- =====================
-- 2. lt_propagate_match_result_to_bracket — partner-aware winner lookup
-- =====================
-- Body from 20260510170010; only the winner-registration resolution changes.
-- The sampled winning-team player can be a captain or a partner, so resolve
-- against the slot's own two registrations by either column. Both winning
-- doubles players map to the same registration (attach enforces set
-- equality), so the LIMIT 1 sample stays correct.

CREATE OR REPLACE FUNCTION public.lt_propagate_match_result_to_bracket(p_match_result_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mr           match_result;
    v_tm           tournament_matches;
    v_winner_user  uuid;
    v_winner_reg   uuid;
    v_score_text   text;
BEGIN
    SELECT * INTO v_mr FROM match_result WHERE id = p_match_result_id;
    IF v_mr.id IS NULL OR v_mr.is_verified IS NOT TRUE THEN
        RETURN;
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE match_id = v_mr.match_id;
    IF v_tm.id IS NULL THEN
        RETURN;
    END IF;
    IF v_tm.status = 'completed' THEN
        RETURN;
    END IF;

    SELECT mp.player_id INTO v_winner_user
      FROM match_participant mp
     WHERE mp.match_id    = v_mr.match_id
       AND mp.team_number = v_mr.winning_team
     LIMIT 1;
    IF v_winner_user IS NULL THEN
        RETURN;
    END IF;

    SELECT r.id INTO v_winner_reg
      FROM tournament_registrations r
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
       AND (r.user_id = v_winner_user OR r.partner_user_id = v_winner_user);
    IF v_winner_reg IS NULL THEN
        RETURN;
    END IF;

    SELECT string_agg(s.team1_score || '-' || s.team2_score, ' ' ORDER BY s.set_number)
      INTO v_score_text
      FROM match_set s
     WHERE s.match_result_id = v_mr.id;

    UPDATE tournament_matches
       SET winner_registration_id = v_winner_reg,
           score                  = v_score_text,
           status                 = 'completed',
           played_at              = now(),
           version                = version + 1,
           updated_at             = now()
     WHERE id = v_tm.id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament_match', v_tm.id, 'submit_score',
        coalesce(v_mr.confirmed_by, v_mr.submitted_by),
        jsonb_build_object(
            'tournament_id', v_tm.tournament_id,
            'round', v_tm.round_number,
            'position', v_tm.match_position,
            'winner_registration_id', v_winner_reg,
            'score', v_score_text,
            'match_result_id', v_mr.id
        )
    );

    PERFORM public.lt_advance_tournament_winner(v_tm.id, v_winner_reg);
END;
$$;


-- =====================
-- 3. tournament_withdraw — notify the other pair member
-- =====================
-- Body from 20260612160200 plus the tournament_partner_withdrew notice.

CREATE OR REPLACE FUNCTION public.tournament_withdraw(
    p_registration_id uuid,
    p_version_was     integer
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_row          tournament_registrations;
    v_status       tournament_status;
    v_other_member uuid;
    v_t_name       text;
    v_caller_name  text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Withdrawal is only allowed during the registration-open period. Scope the
    -- lookup to the caller's own entry (captain or partner); if it's missing or
    -- owned by someone else, v_status is NULL and we let the UPDATE-fallback
    -- below raise the precise error.
    SELECT t.status INTO v_status
      FROM tournament_registrations r
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE r.id = p_registration_id
       AND (r.user_id = v_caller_id OR r.partner_user_id = v_caller_id);

    IF v_status IS NOT NULL AND v_status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WITHDRAW_NOT_ALLOWED';
    END IF;

    UPDATE tournament_registrations
       SET status        = 'withdrawn',
           withdrawn_at  = now(),
           version       = version + 1,
           updated_at    = now()
     WHERE id      = p_registration_id
       AND (user_id = v_caller_id OR partner_user_id = v_caller_id)
       AND version = p_version_was
       AND status IN ('registered', 'pending', 'waitlisted')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id
               AND (user_id = v_caller_id OR partner_user_id = v_caller_id)
               AND version <> p_version_was
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id
               AND user_id <> v_caller_id
               AND (partner_user_id IS NULL OR partner_user_id <> v_caller_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_OWNER';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'withdraw', v_caller_id,
        jsonb_build_object('tournament_id', v_row.tournament_id, 'status', v_row.status)
    );

    -- Doubles: tell the other pair member their entry is gone.
    IF v_row.partner_user_id IS NOT NULL THEN
        v_other_member := CASE
            WHEN v_caller_id = v_row.user_id THEN v_row.partner_user_id
            ELSE v_row.user_id
        END;
        SELECT name INTO v_t_name FROM tournaments WHERE id = v_row.tournament_id;
        SELECT first_name INTO v_caller_name FROM profile WHERE id = v_caller_id;
        PERFORM insert_notification(
            v_other_member,
            'tournament_partner_withdrew',
            v_row.tournament_id,
            'Team withdrawn',
            COALESCE(v_caller_name, 'Your partner') || ' withdrew your team from ' || COALESCE(v_t_name, 'the tournament') || '.',
            jsonb_build_object('tournamentId', v_row.tournament_id, 'withdrawnBy', v_caller_id),
            'normal'
        );
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_withdraw(uuid, integer) TO authenticated;
