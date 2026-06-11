-- ============================================
-- Leagues & Tournaments — V4 (revised): user-driven match → bracket attach
-- ============================================
-- Replaces the auto-create flow (170009) with a user-driven flow:
--   1. generate_bracket only creates the bracket structure — no `match` rows.
--   2. Players see who they're paired with in the bracket.
--   3. They create a regular casual match via the normal Create Match flow,
--      play it, and confirm the score through the existing flow.
--   4. They tap a bracket slot → "Link a played match" picker → pick the
--      verified match → bracket gets the winner + score, advances.
--
-- This migration:
--   - Drops the auto-create trigger + helper from 170009 (no longer needed).
--   - Reverts the time-gate skip in submit_match_result_for_match
--     (player-created matches use real dates → standard 48h gate applies).
--   - Adds tournament_attach_match RPC for the explicit linking action.
--   - Refactors the propagation logic into lt_propagate_match_result_to_bracket
--     so both the existing match_result trigger AND the new attach RPC
--     can drive bracket advancement.
-- ============================================


-- =====================
-- 1. Drop auto-create trigger + helper
-- =====================

DROP TRIGGER IF EXISTS lt_tournament_match_autocreate_match ON tournament_matches;
DROP FUNCTION IF EXISTS public.lt_tournament_match_autocreate_match_tg();
DROP FUNCTION IF EXISTS public.lt_create_match_for_tournament_match(uuid);


-- =====================
-- 2. Revert submit_match_result_for_match to its pre-bridge body
-- =====================
-- Same body as the original 5-arg version from before 170009 — drop the
-- `v_is_tournament_linked` short-circuit. Now that matches are created by
-- players via the regular flow, the 48h gate is appropriate.

CREATE OR REPLACE FUNCTION public.submit_match_result_for_match(
    p_match_id     uuid,
    p_submitted_by uuid,
    p_winning_team integer,
    p_sets         jsonb,
    p_partner_id   uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id              UUID;
  v_is_participant         BOOLEAN;
  v_match_exists           BOOLEAN;
  v_has_result             BOOLEAN;
  v_match_cancelled        BOOLEAN;
  v_match_end_utc          TIMESTAMPTZ;
  v_match_ended            BOOLEAN;
  v_within_48h             BOOLEAN;
  v_set_count              INT;
  v_set_el                 JSONB;
  v_team1_total            INT := 0;
  v_team2_total            INT := 0;
  v_result_id              UUID;
  v_i                      INT;
  v_match_format           TEXT;
  v_joined_count           INT;
  v_partner_is_participant BOOLEAN;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_player_id != p_submitted_by THEN
    RAISE EXCEPTION 'Cannot submit score on behalf of another player';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM match_participant mp
    WHERE mp.match_id = p_match_id
      AND mp.player_id = p_submitted_by
      AND mp.status = 'joined'
  ) INTO v_is_participant;
  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'Player is not a joined participant of this match';
  END IF;

  SELECT EXISTS(SELECT 1 FROM match m WHERE m.id = p_match_id),
         COALESCE((SELECT m.cancelled_at IS NOT NULL FROM match m WHERE m.id = p_match_id), TRUE)
  INTO v_match_exists, v_match_cancelled;
  IF NOT v_match_exists OR v_match_cancelled THEN
    RAISE EXCEPTION 'Match not found or cancelled';
  END IF;

  SELECT EXISTS(SELECT 1 FROM match_result mr WHERE mr.match_id = p_match_id)
  INTO v_has_result;
  IF v_has_result THEN
    RAISE EXCEPTION 'Match already has a result';
  END IF;

  SELECT
    CASE
      WHEN m.timezone IS NOT NULL THEN
        CASE
          WHEN m.end_time < m.start_time THEN
            timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp)
          ELSE
            timezone(m.timezone, (m.match_date + m.end_time)::timestamp)
        END
      ELSE
        (m.match_date + m.end_time)::timestamptz
    END
  INTO v_match_end_utc
  FROM match m
  WHERE m.id = p_match_id;

  v_match_ended := v_match_end_utc < NOW();
  IF NOT v_match_ended THEN
    RAISE EXCEPTION 'Match has not ended yet';
  END IF;

  v_within_48h := v_match_end_utc > (NOW() - INTERVAL '48 hours');
  IF NOT v_within_48h THEN
    RAISE EXCEPTION 'Score can only be registered within 48 hours after match end';
  END IF;

  IF p_winning_team IS NOT NULL AND p_winning_team NOT IN (1, 2) THEN
    RAISE EXCEPTION 'winning_team must be 1, 2, or null';
  END IF;

  IF jsonb_typeof(p_sets) != 'array' THEN
    RAISE EXCEPTION 'sets must be a JSON array';
  END IF;
  v_set_count := jsonb_array_length(p_sets);
  IF v_set_count < 1 OR v_set_count > 5 THEN
    RAISE EXCEPTION 'sets must contain 1 to 5 elements';
  END IF;

  FOR v_i IN 0..(v_set_count - 1) LOOP
    v_set_el := p_sets->v_i;
    IF jsonb_typeof(v_set_el) != 'object' THEN
      RAISE EXCEPTION 'Each set must be an object';
    END IF;
    IF NOT (v_set_el ? 'team1_score' AND v_set_el ? 'team2_score') THEN
      RAISE EXCEPTION 'Each set must have team1_score and team2_score';
    END IF;
    IF (v_set_el->>'team1_score')::INT IS NULL OR (v_set_el->>'team1_score')::INT < 0 OR
       (v_set_el->>'team2_score')::INT IS NULL OR (v_set_el->>'team2_score')::INT < 0 THEN
      RAISE EXCEPTION 'Set scores must be non-negative integers';
    END IF;
    IF (v_set_el->>'team1_score')::INT > (v_set_el->>'team2_score')::INT THEN
      v_team1_total := v_team1_total + 1;
    ELSIF (v_set_el->>'team2_score')::INT > (v_set_el->>'team1_score')::INT THEN
      v_team2_total := v_team2_total + 1;
    END IF;
  END LOOP;

  SELECT m.format INTO v_match_format FROM match m WHERE m.id = p_match_id;

  SELECT COUNT(*) INTO v_joined_count
  FROM match_participant mp
  WHERE mp.match_id = p_match_id AND mp.status = 'joined';

  IF v_match_format = 'singles' THEN
    UPDATE match_participant
       SET team_number = 1
     WHERE match_id = p_match_id AND player_id = p_submitted_by AND status = 'joined';

    UPDATE match_participant
       SET team_number = 2
     WHERE match_id = p_match_id AND player_id != p_submitted_by AND status = 'joined';

  ELSIF v_match_format = 'doubles' THEN
    IF p_partner_id IS NULL THEN
      RAISE EXCEPTION 'p_partner_id is required for doubles matches';
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM match_participant mp
      WHERE mp.match_id = p_match_id
        AND mp.player_id = p_partner_id
        AND mp.player_id != p_submitted_by
        AND mp.status = 'joined'
    ) INTO v_partner_is_participant;

    IF NOT v_partner_is_participant THEN
      RAISE EXCEPTION 'Partner is not a valid joined participant of this match';
    END IF;

    UPDATE match_participant
       SET team_number = 1
     WHERE match_id = p_match_id
       AND player_id IN (p_submitted_by, p_partner_id)
       AND status = 'joined';

    UPDATE match_participant
       SET team_number = 2
     WHERE match_id = p_match_id
       AND player_id NOT IN (p_submitted_by, p_partner_id)
       AND status = 'joined';
  END IF;

  INSERT INTO match_result (
    match_id, winning_team, team1_score, team2_score,
    is_verified, submitted_by, confirmation_deadline
  )
  VALUES (
    p_match_id, p_winning_team, v_team1_total, v_team2_total,
    FALSE, p_submitted_by, NOW() + INTERVAL '24 hours'
  )
  RETURNING id INTO v_result_id;

  FOR v_i IN 0..(v_set_count - 1) LOOP
    v_set_el := p_sets->v_i;
    INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
    VALUES (
      v_result_id, v_i + 1,
      (v_set_el->>'team1_score')::INT,
      (v_set_el->>'team2_score')::INT
    );
  END LOOP;

  RETURN v_result_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_match_result_for_match(uuid, uuid, integer, jsonb, uuid) TO authenticated, service_role;


-- =====================
-- 3. Refactor: extract propagation so both the trigger and the attach RPC
--    can drive bracket advancement
-- =====================

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

    SELECT id INTO v_winner_reg
      FROM tournament_registrations
     WHERE tournament_id = v_tm.tournament_id
       AND user_id       = v_winner_user;
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


-- Update the existing trigger function to delegate to the helper.
CREATE OR REPLACE FUNCTION public.lt_match_result_propagation_tg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.is_verified IS NOT TRUE THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.is_verified IS TRUE THEN
        RETURN NEW;
    END IF;

    PERFORM public.lt_propagate_match_result_to_bracket(NEW.id);
    RETURN NEW;
END;
$$;


-- Also strip the now-unused auto-advance side effects from
-- lt_advance_tournament_winner: it should NOT auto-create downstream match
-- rows anymore (no auto-create flow). Phantom-vs-winner auto-completes
-- still apply.

CREATE OR REPLACE FUNCTION public.lt_advance_tournament_winner(
    p_tournament_match_id  uuid,
    p_winner_registration_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_curr        tournament_matches;
    v_next        tournament_matches;
    v_curr_winner uuid := p_winner_registration_id;
    v_other_bye   boolean;
    v_other_reg   uuid;
    v_tournament  tournaments;
BEGIN
    SELECT * INTO v_curr FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_curr.id IS NULL THEN
        RETURN;
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_curr.tournament_id;

    IF v_tournament.bracket_locked_at IS NULL THEN
        UPDATE tournaments
           SET bracket_locked_at = now(),
               updated_at        = now()
         WHERE id = v_tournament.id;
    END IF;

    WHILE v_curr.next_match_id IS NOT NULL LOOP
        SELECT * INTO v_next FROM tournament_matches
         WHERE id = v_curr.next_match_id FOR UPDATE;

        IF v_curr.next_match_slot = 1 THEN
            UPDATE tournament_matches
               SET player1_registration_id = v_curr_winner,
                   player1_is_bye          = false,
                   version                 = version + 1,
                   updated_at              = now()
             WHERE id = v_next.id;
        ELSE
            UPDATE tournament_matches
               SET player2_registration_id = v_curr_winner,
                   player2_is_bye          = false,
                   version                 = version + 1,
                   updated_at              = now()
             WHERE id = v_next.id;
        END IF;

        SELECT * INTO v_next FROM tournament_matches WHERE id = v_next.id;

        IF v_curr.next_match_slot = 1 THEN
            v_other_bye := v_next.player2_is_bye;
            v_other_reg := v_next.player2_registration_id;
        ELSE
            v_other_bye := v_next.player1_is_bye;
            v_other_reg := v_next.player1_registration_id;
        END IF;

        IF v_other_bye AND v_other_reg IS NULL THEN
            UPDATE tournament_matches
               SET winner_registration_id = v_curr_winner,
                   status                 = 'completed',
                   version                = version + 1,
                   updated_at             = now()
             WHERE id = v_next.id
            RETURNING * INTO v_next;
            v_curr := v_next;
        ELSE
            EXIT;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM tournament_matches m
         WHERE m.tournament_id = v_tournament.id
           AND m.next_match_id IS NULL
           AND m.bracket_side = 'main'
           AND m.status = 'completed'
           AND m.winner_registration_id IS NOT NULL
    ) THEN
        UPDATE tournaments
           SET status     = 'completed',
               version    = version + 1,
               updated_at = now()
         WHERE id = v_tournament.id
           AND status = 'in_progress';
    END IF;
END;
$$;


-- =====================
-- 4. tournament_attach_match RPC
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
    v_match       match;
    v_p1_user     uuid;
    v_p2_user     uuid;
    v_caller_ok   boolean;
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

    -- The caller must be one of the two bracket players
    SELECT user_id INTO v_p1_user
      FROM tournament_registrations WHERE id = v_tm.player1_registration_id;
    SELECT user_id INTO v_p2_user
      FROM tournament_registrations WHERE id = v_tm.player2_registration_id;
    v_caller_ok := v_caller_id IN (v_p1_user, v_p2_user);
    IF NOT v_caller_ok AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_PARTICIPANT';
    END IF;

    -- The match must exist, match the tournament's sport, and not already
    -- be attached to another tournament_match.
    SELECT * INTO v_match FROM match WHERE id = p_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;
    IF v_match.sport_id <> v_t.sport_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SPORT_MISMATCH';
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE match_id = p_match_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
    END IF;

    -- The match's joined participants must be exactly the two bracket players
    SELECT array_agg(player_id ORDER BY player_id) INTO v_match_users
      FROM match_participant
     WHERE match_id = p_match_id AND status = 'joined';

    IF v_match_users IS NULL OR array_length(v_match_users, 1) <> 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTICIPANTS_MISMATCH';
    END IF;
    IF NOT (v_p1_user = ANY(v_match_users) AND v_p2_user = ANY(v_match_users)) THEN
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

GRANT EXECUTE ON FUNCTION public.tournament_attach_match(uuid, uuid) TO authenticated;
