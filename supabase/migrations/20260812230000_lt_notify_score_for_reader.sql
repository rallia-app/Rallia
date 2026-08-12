-- The result notice showed the score as stored, not as the reader lived it.
--
-- tournament_matches.score is player1-first (20260812210000). Only the LOSING
-- side is told "résultat du tour N enregistré (…)", and a loser who happened to
-- sit in the player2 slot was shown the winner's numbers, so their own defeat
-- read as a win. Measured on a staging fixture where the tester lost all three
-- pool games: the two he played from the player2 slot arrived as "(6-2 6-2)".
--
-- This is the notification half of the same defect he reported on the standings
-- screen. The fix orients the score onto the recipient's side, and does the same
-- for payload.score, which no client reads today but would inherit the trap.

-- Orient a player1-first score string for one side of the game. p_is_player1
-- true returns it unchanged; false turns every set round.
CREATE OR REPLACE FUNCTION public.lt_score_for_side(p_score text, p_is_player1 boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN p_score IS NULL OR p_is_player1 IS NOT FALSE THEN p_score
           ELSE (
             SELECT string_agg(
                      CASE WHEN t.tok ~ '^\d+-\d+$'
                           THEN split_part(t.tok, '-', 2) || '-' || split_part(t.tok, '-', 1)
                           ELSE t.tok END,
                      ' ' ORDER BY t.ord)
               FROM unnest(string_to_array(p_score, ' ')) WITH ORDINALITY AS t(tok, ord)
           )
         END;
$$;

COMMENT ON FUNCTION public.lt_score_for_side(text, boolean) IS
    'Turns a player1-first score string round for the player2 side. Non-set tokens (W/O, RET) pass through untouched.';

GRANT EXECUTE ON FUNCTION public.lt_score_for_side(text, boolean) TO authenticated;

-- ============================================
-- notify_tournament_match_completed — the loser reads their own score
-- ============================================

CREATE OR REPLACE FUNCTION public.notify_tournament_match_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_t tournaments;
  v_loser_reg uuid;
  v_next tournament_matches;
  v_opp_reg uuid;
  v_opp_name text;
  v_winner_members uuid[];
  v_loser_members uuid[];
  v_loser_score text;
BEGIN
  SELECT * INTO v_t FROM tournaments WHERE id = NEW.tournament_id;
  IF v_t.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_loser_reg := CASE WHEN NEW.winner_registration_id = NEW.player1_registration_id
                      THEN NEW.player2_registration_id
                      ELSE NEW.player1_registration_id
                 END;

  SELECT array_remove(ARRAY[r.user_id, r.partner_user_id], NULL) INTO v_winner_members
    FROM tournament_registrations r WHERE r.id = NEW.winner_registration_id;
  SELECT array_remove(ARRAY[r.user_id, r.partner_user_id], NULL) INTO v_loser_members
    FROM tournament_registrations r WHERE r.id = v_loser_reg;

  -- Only the losing side is told the score, so state it from THEIR side. The
  -- column is player1-first, so it already reads loser-first when the winner
  -- was player2 and needs turning round when the winner was player1.
  v_loser_score := public.lt_score_for_side(
      NEW.score, v_loser_reg = NEW.player1_registration_id);

  -- Loser side: result recorded.
  PERFORM insert_notification(
    m,
    'tournament_match_completed',
    NEW.tournament_id,
    CASE WHEN public.lt_user_is_fr(m) THEN 'Résultat enregistré' ELSE 'Result recorded' END,
    CASE WHEN public.lt_user_is_fr(m)
      THEN v_t.name || ' : résultat du tour ' || NEW.round_number || ' enregistré'
           || coalesce(' (' || nullif(v_loser_score, '') || ')', '') || '.'
      ELSE v_t.name || ': round ' || NEW.round_number || ' result recorded'
           || coalesce(' (' || nullif(v_loser_score, '') || ')', '') || '.'
    END,
    jsonb_build_object(
      'tournamentId', NEW.tournament_id,
      'tournamentName', v_t.name,
      'tournamentMatchId', NEW.id,
      'round', NEW.round_number,
      'score', v_loser_score,
      'won', false
    ),
    'normal'
  )
  FROM unnest(coalesce(v_loser_members, '{}')) m
  WHERE m IS DISTINCT FROM v_actor;

  -- Winner side: advancement info. Re-read live state (the deferred firing
  -- runs after advancement, and phantom byes can skip rounds). Winning the
  -- final is covered by tournament_completed instead.
  SELECT * INTO v_next
    FROM tournament_matches tm
   WHERE tm.tournament_id = NEW.tournament_id
     AND tm.status NOT IN ('completed', 'cancelled')
     AND (tm.player1_registration_id = NEW.winner_registration_id
          OR tm.player2_registration_id = NEW.winner_registration_id)
   ORDER BY tm.round_number
   LIMIT 1;

  IF v_next.id IS NOT NULL THEN
    v_opp_reg := CASE WHEN v_next.player1_registration_id = NEW.winner_registration_id
                      THEN v_next.player2_registration_id
                      ELSE v_next.player1_registration_id
                 END;
    v_opp_name := public.lt_registration_display_name(v_opp_reg);

    PERFORM insert_notification(
      m,
      'tournament_match_completed',
      NEW.tournament_id,
      CASE WHEN public.lt_user_is_fr(m) THEN 'Tu passes au tour suivant' ELSE 'You advanced' END,
      CASE WHEN public.lt_user_is_fr(m)
        THEN v_t.name || ' : tu accèdes au tour ' || v_next.round_number
             || coalesce(' contre ' || v_opp_name, ', adversaire à confirmer') || '.'
        ELSE v_t.name || ': you advanced to round ' || v_next.round_number
             || coalesce(' vs ' || v_opp_name, ', opponent to be determined') || '.'
      END,
      jsonb_build_object(
        'tournamentId', NEW.tournament_id,
        'tournamentName', v_t.name,
        'tournamentMatchId', v_next.id,
        'round', v_next.round_number,
        'opponentRegistrationId', v_opp_reg,
        'opponentName', v_opp_name,
        'won', true
      ),
      'high'
    )
    FROM unnest(coalesce(v_winner_members, '{}')) m
    WHERE m IS DISTINCT FROM v_actor;
  END IF;

  RETURN NULL;
END;
$$;
