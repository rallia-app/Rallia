-- ============================================================================
-- A contest cannot land once the draw has moved past the pairing.
-- ============================================================================
-- Contesting flips the pairing to 'disputed', which is R0: the ladder stops and
-- the organizer rules. That is a reopening, so it needs the same limit the undo
-- path has carried since 20260831150000. Once the side that advanced holds a
-- result of its own there is nothing to reopen without unwinding a round that
-- has already been played.
--
-- Until now the window was time alone. A score declared an hour before the
-- deadline stayed contestable for 48 h, which is longer than the next round
-- takes to start, so a tournament could be made to wait on a pairing whose
-- winner was already through. Jean's retest of 31 August, section 9: "une fois
-- l'etape d'apres enclenchee, le score ne doit plus etre contestable /
-- modifiable, meme si le delai n'est pas respecte."
--
-- Both bodies are copied from their latest definitions, contest_match_result
-- from 20260831160000 and match_contest_state from 20260901060000, with the
-- window check added.
-- ============================================================================

-- ------------------------------------------------------- the write path
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

    SELECT tm.id INTO v_tm FROM tournament_matches tm WHERE tm.match_id = p_match_id;

    -- An unreadable window counts as closed: refusing a late contest costs one
    -- organizer message, reopening a played round costs the round.
    IF v_tm IS NOT NULL
       AND NOT COALESCE(public.lt_restore_window_open(v_tm), false) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAIRING_ALREADY_ADVANCED';
    END IF;

    UPDATE match_result SET disputed = true WHERE id = v_mr.id RETURNING * INTO v_row;

    -- On a tournament pairing this is R0: the ladder stops and the organizer
    -- rules. Elsewhere the dispute flag alone is the record.
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
'The opponent disputes a declared score inside its window. On a tournament
pairing this flips the row to disputed, which is R0: the ladder stops and the
organizer decides. Refused to the declarer, once the time window has closed,
and once the draw has advanced past the pairing (lt_restore_window_open).
Spec: the original unplayed-match doc, § 1 stage 5 and § 9.';

REVOKE ALL ON FUNCTION public.contest_match_result(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contest_match_result(uuid) TO authenticated;

-- ------------------------------------------------------- what the control reads
CREATE OR REPLACE FUNCTION public.match_contest_state(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_mr       match_result;
    v_tm       uuid;
    v_advanced boolean;
BEGIN
    IF v_caller IS NULL THEN
        RETURN jsonb_build_object('contestable', false);
    END IF;

    SELECT * INTO v_mr FROM match_result WHERE match_id = p_match_id
     ORDER BY created_at DESC LIMIT 1;
    IF v_mr.id IS NULL THEN
        RETURN jsonb_build_object('contestable', false);
    END IF;

    SELECT tm.id INTO v_tm FROM tournament_matches tm WHERE tm.match_id = p_match_id;
    v_advanced := v_tm IS NOT NULL
                  AND NOT COALESCE(public.lt_restore_window_open(v_tm), false);

    RETURN jsonb_build_object(
        'hasResult',   true,
        'disputed',    COALESCE(v_mr.disputed, false),
        'deadline',    v_mr.confirmation_deadline,
        'isDeclarer',  v_mr.submitted_by = v_caller,
        'advanced',    v_advanced,
        'contestable',
            COALESCE(v_mr.disputed, false) = false
            AND v_mr.submitted_by IS DISTINCT FROM v_caller
            AND (v_mr.confirmation_deadline IS NULL OR now() <= v_mr.confirmation_deadline)
            AND NOT v_advanced
            AND EXISTS (SELECT 1 FROM match_participant mp
                         WHERE mp.match_id = p_match_id AND mp.player_id = v_caller
                           AND mp.status = 'joined')
    );
END;
$$;

COMMENT ON FUNCTION public.match_contest_state(uuid) IS
'Whether THIS caller can still contest the declared score on this match: a
participant who did not declare it, inside the window, on a result nobody has
contested yet, and on a pairing the draw has not advanced past. `advanced`
reports that last condition on its own.';

REVOKE ALL ON FUNCTION public.match_contest_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_contest_state(uuid) TO authenticated;
