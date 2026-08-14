-- The advancement notice could arrive twice, word for word.
--
-- notify_tournament_match_completed is a DEFERRABLE INITIALLY DEFERRED trigger,
-- so its events queue during the transaction and all fire at commit, each
-- re-reading live state to find the winner's next game. That re-read is
-- deliberate (advancement and phantom byes run first), but it means several
-- completions for the SAME player inside one transaction all resolve to the
-- same next game and each announces it. Measured on a staging fixture: two pool
-- wins settled in one script run produced two identical
-- "Tu passes au tour suivant / tu accèdes au tour 1 contre Raphaël Lacasse".
--
-- Entering scores from the app is one game per transaction and was never
-- affected; batched paths (seeding, a bulk settle, an admin tool) are. The guard
-- follows the existing notification idiom (20260805140100, 20260807120000):
-- refuse to repeat a notice that is already there.

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
    WHERE m IS DISTINCT FROM v_actor
      -- One advancement notice per (player, next game, opponent). This trigger
      -- is DEFERRED and re-reads live state at commit, so when several of a
      -- player's games complete inside ONE transaction every queued event
      -- resolves v_next to the SAME row and each would announce it again. Real
      -- score entry is one game per transaction and unaffected; a batch (a
      -- seeding script, a bulk settle) produced word-for-word duplicates.
      -- Keying on the opponent too keeps a genuine re-notify when a slot that
      -- was "adversaire à confirmer" later resolves to a name.
      AND NOT EXISTS (
        SELECT 1 FROM notification n
         WHERE n.user_id = m
           AND n.type = 'tournament_match_completed'
           AND n.payload->>'tournamentMatchId' = v_next.id::text
           AND n.payload->>'opponentRegistrationId' IS NOT DISTINCT FROM v_opp_reg::text
      );
  END IF;

  RETURN NULL;
END;
$$;
