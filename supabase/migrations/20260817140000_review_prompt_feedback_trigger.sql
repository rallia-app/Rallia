-- ============================================================================
-- Review prompt: gate on completed match feedback, not on games played
-- ============================================================================
-- 20260817120000 gated on ">= 3 games with outcome 'played'". Measuring it
-- showed that gate is nearly inert: of the players who have played at all, 67
-- had >=1 game and 65 cleared >=3, so it excluded almost nobody. It is also a
-- LIFETIME count, so three games last year scored the same as three this month.
--
-- Completing the post-match feedback form is the better signal on both counts.
-- It is optional, effortful and pro-social, so doing it repeatedly is real
-- goodwill rather than mere presence, and it is far more selective: 66 players
-- have submitted at least one, 33 have submitted three or more.
--
-- It is also the better MOMENT, which is why the gate and the trigger are now
-- the same event. Score confirmation, the previous trigger, can just as easily
-- follow a 6-0 6-0 defeat; finishing the feedback form is a reflective,
-- task-complete point with no obligation left hanging.
--
-- Deliberately counts feedback SUBMITTED, never whether it was positive. The
-- valence is about the opponent rather than about Rallia, so it is not a
-- classic "Enjoying Rallia?" gate, but selecting on it would still mean
-- choosing who to ask by expected positivity and would skew the sample by mood.
-- It also buys very little: only 24 of those 33 players gave 4-5 stars, so the
-- filter costs a quarter of the pool to exclude people who mostly rated an
-- opponent 3 out of 5. Valence is recorded as an analytics property instead, so
-- whether it predicts anything can be settled with data later.
--
-- Unit is DISTINCT match_id: one form covering three opponents writes three
-- match_feedback rows but is one "event" in the sense that matters here.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.review_prompt_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_player      uuid := auth.uid();
    v_prompts     integer;
    v_last_shown  timestamptz;
    v_feedbacks   integer;
    v_open_ticket boolean;
    v_bad_recent  boolean;
BEGIN
    IF v_player IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'not_authenticated');
    END IF;

    SELECT count(*), max(shown_at)
      INTO v_prompts, v_last_shown
      FROM player_review_prompt
     WHERE player_id = v_player
       AND shown_at >= now() - interval '365 days';

    IF v_prompts >= 2 THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'throttled_year',
            'prompts_in_window', v_prompts
        );
    END IF;

    IF v_last_shown IS NOT NULL AND v_last_shown >= now() - interval '90 days' THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'throttled_recent',
            'prompts_in_window', v_prompts
        );
    END IF;

    SELECT count(DISTINCT mf.match_id)
      INTO v_feedbacks
      FROM match_feedback mf
     WHERE mf.reviewer_id = v_player;

    IF v_feedbacks < 3 THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'not_enough_feedback',
            'feedbacks_submitted', v_feedbacks
        );
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM feedback f
         WHERE f.player_id = v_player
           AND f.status IN ('new', 'reviewed', 'in_progress')
    ) INTO v_open_ticket;

    IF v_open_ticket THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'open_feedback',
            'feedbacks_submitted', v_feedbacks
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM match_participant mp
          JOIN match m ON m.id = mp.match_id
         WHERE mp.player_id = v_player
           AND m.match_date >= (current_date - 14)
           AND (
                mp.match_outcome IN ('mutual_cancel', 'opponent_no_show')
             OR mp.showed_up IS FALSE
             OR m.cancelled_at IS NOT NULL
           )
        UNION ALL
        SELECT 1
          FROM match_result mr
          JOIN match_participant mp ON mp.match_id = mr.match_id
         WHERE mp.player_id = v_player
           AND mr.disputed IS TRUE
           AND mr.updated_at >= now() - interval '14 days'
    ) INTO v_bad_recent;

    IF v_bad_recent THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'recent_bad_experience',
            'feedbacks_submitted', v_feedbacks
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible', true,
        'reason', 'ok',
        'feedbacks_submitted', v_feedbacks,
        'prompts_in_window', v_prompts
    );
END;
$$;

COMMENT ON FUNCTION public.review_prompt_eligibility() IS
  'Whether the CURRENT player may be shown a store review prompt right now. '
  'Behavioural and anti-interruption rules only: counts completed match '
  'feedback sessions, never their valence, which is what keeps this compliant '
  'with Apple 5.6.1 and the Google Play In-App Review policy. Every negative '
  'reason is time-bound, so no player is permanently excluded.';
