-- ============================================================================
-- A declared score stands on entry, and is contestable for 48 h.
-- ============================================================================
-- The original spec, § 1 stage 5: "Un des deux l'entre, il fait foi tout de
-- suite ; l'autre peut le contester pendant 48 h ... La même règle s'applique
-- à toutes les parties de l'app, hors tournoi aussi." Until now a score sat
-- unverified behind a 24 h confirmation, so a game both players had finished
-- stayed unresolved until the opponent acted, and a pairing whose opponent
-- never answered reached its deadline with no result at all. That is one of
-- the ways Série 1 pairings ended up settled by hand.
--
-- The change is deliberately one line of behaviour: the result row is written
-- verified, and confirmation_deadline becomes the contest deadline. Everything
-- downstream that keys on is_verified (ratings, standings, the bracket
-- propagation) therefore fires when the score is entered, which is the point:
-- the record is true as soon as somebody says what happened.
--
-- What guards it is the contest, not a wait. contest_match_result lets the
-- opponent dispute inside the window; on a tournament pairing that flips the
-- row to disputed, which is R0 of the ladder, so the machine stops and the
-- organizer rules. An uncontested score simply stands.
--
-- confirm_match_score stays, and becomes idempotent on an already-verified
-- row: older clients still call it, and legacy unverified rows still need it.
-- propose_rebuttal_score is untouched for the same reason.
--
-- Body re-issued from 20260510170010, verified byte-identical against the live
-- definition before editing.
-- ============================================================================

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
    -- One-way registration: the declared score is authoritative the moment it
    -- is entered, and the deadline below is now the CONTEST window rather than
    -- a wait for confirmation.
    p_match_id, p_winning_team, v_team1_total, v_team2_total,
    TRUE, p_submitted_by, NOW() + INTERVAL '48 hours'
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

-- ------------------------------------------- confirming stays, harmlessly
-- A score is already authoritative, so confirming is a no-op that must not
-- error: the button exists in shipped clients, and legacy rows written before
-- this migration are still unverified and still need it.
-- Keeps its boolean return: shipped clients read it.
CREATE OR REPLACE FUNCTION public.confirm_match_score(
    p_match_result_id uuid,
    p_player_id       uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mr match_result;
BEGIN
    -- The sweep-3 shape: enforced against a real JWT, but a definer-internal
    -- or server context (no auth.uid()) still passes, which
    -- rpc_caller_guards_sweep3_test asserts explicitly.
    IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_mr FROM match_result WHERE id = p_match_result_id;
    IF v_mr.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESULT_NOT_FOUND';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM match_participant mp
         WHERE mp.match_id = v_mr.match_id AND mp.player_id = p_player_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    IF v_mr.is_verified THEN
        RETURN true;   -- already stands; nothing to confirm
    END IF;

    UPDATE match_result
       SET is_verified = true, verified_at = now()
     WHERE id = p_match_result_id;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_match_score(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_match_score(uuid, uuid) TO authenticated;

-- --------------------------------------------------------- the contest
CREATE OR REPLACE FUNCTION public.contest_match_result(p_match_id uuid)
RETURNS match_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_mr     match_result;
    v_row    match_result;
    v_tm     uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_mr FROM match_result WHERE match_id = p_match_id FOR UPDATE;
    IF v_mr.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESULT_NOT_FOUND';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM match_participant mp
         WHERE mp.match_id = p_match_id AND mp.player_id = v_caller
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    -- The person who declared it cannot contest their own account of it.
    IF v_mr.submitted_by = v_caller THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DECLARER_CANNOT_CONTEST';
    END IF;

    IF v_mr.confirmation_deadline IS NOT NULL AND now() > v_mr.confirmation_deadline THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONTEST_WINDOW_CLOSED';
    END IF;

    UPDATE match_result SET disputed = true WHERE id = v_mr.id RETURNING * INTO v_row;

    -- On a tournament pairing this is R0: the ladder stops and the organizer
    -- rules. Elsewhere the dispute flag alone is the record.
    SELECT tm.id INTO v_tm FROM tournament_matches tm WHERE tm.match_id = p_match_id;
    IF v_tm IS NOT NULL THEN
        UPDATE tournament_matches
           SET status = 'disputed', version = version + 1, updated_at = now()
         WHERE id = v_tm;
        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        SELECT 'tournament_match', v_tm, 'result_contested', v_caller,
               jsonb_build_object('tournament_id', tm.tournament_id, 'match_id', p_match_id)
          FROM tournament_matches tm WHERE tm.id = v_tm;
    END IF;

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.contest_match_result(uuid) IS
'The opponent disputes a declared score inside its 48 h window. On a tournament
pairing this flips the row to disputed, which is R0: the ladder stops and the
organizer decides. Refused to the declarer, and once the window has closed.
Spec: the original unplayed-match doc, § 1 stage 5 and § 9.';

REVOKE ALL ON FUNCTION public.contest_match_result(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contest_match_result(uuid) TO authenticated;
