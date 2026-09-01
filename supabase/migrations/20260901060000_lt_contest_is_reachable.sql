-- ============================================================================
-- A declared score you were never told about.
-- ============================================================================
-- 20260831160000 made a declared score final on entry with a 48h window to
-- contest it. Two halves of that never shipped:
--
--   * nothing notified the other side, and get_pending_score_confirmations
--     filters on is_verified = FALSE, so a one-way score appears on no screen
--     at all. The window could close on someone who never knew a result
--     existed.
--   * contest_match_result had no caller.
--
-- A window nobody is told about is not a safeguard, it is decoration. This
-- adds the notification and the read the contest control needs.
--
-- Spec: score-entry.md, one-way registration.
-- ============================================================================

-- --------------------------------------------------- tell the other side
CREATE OR REPLACE FUNCTION public.notify_match_result_declared(p_result_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mr    match_result;
    v_by    text;
    v_when  timestamptz;
    v_rows  jsonb;
BEGIN
    SELECT * INTO v_mr FROM match_result WHERE id = p_result_id;
    IF v_mr.id IS NULL THEN RETURN; END IF;

    SELECT COALESCE(p.display_name, p.first_name, 'Un joueur') INTO v_by
      FROM profile p WHERE p.id = v_mr.submitted_by;
    v_when := v_mr.confirmation_deadline;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', mp.player_id,
        'type', 'score_confirmation',
        'target_id', v_mr.match_id,
        'title', CASE WHEN public.lt_user_is_fr(mp.player_id)
                   THEN 'Le score a été inscrit' ELSE 'The score was recorded' END,
        'body', CASE WHEN public.lt_user_is_fr(mp.player_id)
                  THEN v_by || ' a inscrit le score de votre partie. Il fait foi. Si ce n''est pas ça, tu as 48 h pour le contester.'
                  ELSE v_by || ' recorded the score of your game. It stands. If that is not right, you have 48h to contest it.' END,
        'payload', jsonb_build_object(
            'matchId', v_mr.match_id,
            'matchResultId', v_mr.id,
            'contestDeadline', v_when
        ),
        'priority', 'high'
    ))
    INTO v_rows
    FROM match_participant mp
   WHERE mp.match_id = v_mr.match_id
     AND mp.player_id <> v_mr.submitted_by
     AND mp.status = 'joined';

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;

COMMENT ON FUNCTION public.notify_match_result_declared(uuid) IS
'Tells everyone but the declarer that a score was entered and stands, naming
the contest deadline. Without it the 48h window expires on players who were
never told a result existed.';

REVOKE ALL ON FUNCTION public.notify_match_result_declared(uuid)
    FROM PUBLIC, anon, authenticated;

-- ------------------------------------------- what the contest control needs
CREATE OR REPLACE FUNCTION public.match_contest_state(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_mr     match_result;
BEGIN
    IF v_caller IS NULL THEN
        RETURN jsonb_build_object('contestable', false);
    END IF;

    SELECT * INTO v_mr FROM match_result WHERE match_id = p_match_id
     ORDER BY created_at DESC LIMIT 1;
    IF v_mr.id IS NULL THEN
        RETURN jsonb_build_object('contestable', false);
    END IF;

    RETURN jsonb_build_object(
        'hasResult',   true,
        'disputed',    COALESCE(v_mr.disputed, false),
        'deadline',    v_mr.confirmation_deadline,
        'isDeclarer',  v_mr.submitted_by = v_caller,
        'contestable',
            COALESCE(v_mr.disputed, false) = false
            AND v_mr.submitted_by IS DISTINCT FROM v_caller
            AND (v_mr.confirmation_deadline IS NULL OR now() <= v_mr.confirmation_deadline)
            AND EXISTS (SELECT 1 FROM match_participant mp
                         WHERE mp.match_id = p_match_id AND mp.player_id = v_caller
                           AND mp.status = 'joined')
    );
END;
$$;

COMMENT ON FUNCTION public.match_contest_state(uuid) IS
'Whether THIS caller can still contest the declared score on this match: a
participant who did not declare it, inside the window, on a result nobody has
contested yet.';

REVOKE ALL ON FUNCTION public.match_contest_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_contest_state(uuid) TO authenticated;

-- --------------------------------------------------- the submit, now telling
CREATE OR REPLACE FUNCTION public.submit_match_result_for_match(p_match_id uuid, p_submitted_by uuid, p_winning_team integer, p_sets jsonb, p_partner_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- The other side has to KNOW a result exists, or the contest window closes
  -- on someone who was never told. Nothing notified them before this: a score
  -- was final on entry and silent, which is the worst of both.
  PERFORM public.notify_match_result_declared(v_result_id);

  RETURN v_result_id;
END;
$function$

;
