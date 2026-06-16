-- ============================================
-- Doubles tournaments — attach must match the team PAIRING, not just the players
-- ============================================
-- Fixes a doubles-only coherence hole in tournament_attach_match
-- (20260612160300): for doubles it required the linked game's four joined
-- participants to equal the two entries' four members AS A SET, but never
-- checked that the game's team_number grouping mirrors the bracket pairs.
--
-- A cross-paired casual game — e.g. captain1+captain2 vs partner1+partner2 —
-- has the same four people, so it passed set-equality and attached. The winner
-- propagation then samples one player on the winning team_number and maps it to
-- whichever bracket registration that player captains/partners, so a registration
-- whose actual teammate LOST could be advanced. Singles can't hit this (two
-- players, no pairing ambiguity).
--
-- Fix: for doubles, after the set check, require each entry's two members to
-- share one team_number in the linked game (and the two entries to sit on
-- opposite teams). team_number is assigned at score submission
-- (20260301000013) and is already read by the linkable-match picker, so a
-- verified doubles game always has it populated. New error: MATCH_PAIRING_MISMATCH.
--
-- Body is 20260612160300's tournament_attach_match verbatim plus the pairing
-- guard + four locals. No other behaviour changes.
-- ============================================

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
    v_t1a         int;
    v_t1b         int;
    v_t2a         int;
    v_t2b         int;
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

    -- Doubles: the linked game's teams must mirror the bracket pairs. Each
    -- entry's two members must share one team_number, and the two entries must
    -- sit on opposite teams — otherwise a cross-paired game (same four people,
    -- wrong pairing) could attach and advance the wrong registration. The set
    -- check above already guarantees the four players are exactly the two pairs.
    IF v_is_doubles THEN
        SELECT team_number INTO v_t1a FROM match_participant
          WHERE match_id = p_match_id AND status = 'joined' AND player_id = v_p1_user;
        SELECT team_number INTO v_t1b FROM match_participant
          WHERE match_id = p_match_id AND status = 'joined' AND player_id = v_p1_partner;
        SELECT team_number INTO v_t2a FROM match_participant
          WHERE match_id = p_match_id AND status = 'joined' AND player_id = v_p2_user;
        SELECT team_number INTO v_t2b FROM match_participant
          WHERE match_id = p_match_id AND status = 'joined' AND player_id = v_p2_partner;

        IF v_t1a IS NULL OR v_t1b IS NULL OR v_t2a IS NULL OR v_t2b IS NULL
           OR v_t1a <> v_t1b OR v_t2a <> v_t2b OR v_t1a = v_t2a THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_PAIRING_MISMATCH';
        END IF;
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
