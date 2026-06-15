-- ============================================
-- Leagues & Tournaments — V4 (bridge): tournament_matches ⇄ match
-- ============================================
-- Spec: specs/17-leagues-tournaments/integrations.md §09 Matches
--   "Tournament matches and league session matches reuse the casual-match
--    data shape and feedback loop"
--
-- Instead of a parallel score-submission RPC, tournament_matches that are
-- ready to play get a paired standalone `match` row. Players use the
-- existing RegisterMatchScoreSheet → submit_match_result_for_match →
-- confirm_match_score / propose_rebuttal_score flow. When the linked
-- match_result.is_verified flips true, a trigger reads the verified
-- result, sets the tournament_match winner, and walks the bracket
-- forward (same propagation logic the V3 generator used).
--
-- Out of scope:
--   - Direct organizer override (tournament_override_score) — V4.x
--   - Reputation events for completion/no-show — later
--   - league sessions (V7+, follows the same bridge pattern)
-- ============================================


-- =====================
-- 1. Schema link
-- =====================

ALTER TABLE tournament_matches
    ADD COLUMN IF NOT EXISTS match_id uuid UNIQUE REFERENCES match(id) ON DELETE SET NULL;

COMMENT ON COLUMN tournament_matches.match_id IS
    'Standalone match row players use to enter scores via the existing match flow. NULL until the tournament_match becomes playable (both slots filled with real registrations).';


-- =====================
-- 2. Helper: create the standalone match row + participants
-- =====================
-- Idempotent: returns existing match_id if already linked, otherwise
-- creates everything. Skips silently when the tournament_match isn't
-- playable (BYE on either side, missing slots, non-pending status).

CREATE OR REPLACE FUNCTION public.lt_create_match_for_tournament_match(p_tm_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm          tournament_matches;
    v_t           tournaments;
    v_p1_user     uuid;
    v_p2_user     uuid;
    v_match_id    uuid;
    v_match_date  date;
    v_start_time  time;
    v_end_time    time;
    v_notes       text;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id FOR UPDATE;
    IF v_tm.id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Already linked
    IF v_tm.match_id IS NOT NULL THEN
        RETURN v_tm.match_id;
    END IF;

    -- Not yet playable
    IF v_tm.status <> 'pending'
       OR v_tm.player1_is_bye OR v_tm.player2_is_bye
       OR v_tm.player1_registration_id IS NULL OR v_tm.player2_registration_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;

    SELECT user_id INTO v_p1_user
      FROM tournament_registrations WHERE id = v_tm.player1_registration_id;
    SELECT user_id INTO v_p2_user
      FROM tournament_registrations WHERE id = v_tm.player2_registration_id;

    IF v_p1_user IS NULL OR v_p2_user IS NULL THEN
        RETURN NULL;
    END IF;

    -- Date/time defaults. tournament_match.scheduled_at wins; otherwise the
    -- tournament's start_date acts as a placeholder. The submit RPC's
    -- "ended + 48h" gate is bypassed for tournament-linked matches (see
    -- patch below), so these times are mostly informational.
    IF v_tm.scheduled_at IS NOT NULL THEN
        v_match_date := v_tm.scheduled_at::date;
        v_start_time := v_tm.scheduled_at::time;
        v_end_time   := (v_tm.scheduled_at + interval '90 minutes')::time;
    ELSE
        v_match_date := v_t.start_date::date;
        v_start_time := '09:00:00'::time;
        v_end_time   := '20:00:00'::time;
    END IF;

    v_notes := format('Tournament: %s — Round %s, Match %s',
                      v_t.name, v_tm.round_number, v_tm.match_position);

    -- created_by = player 1's user. The match table's
    -- create_host_participant trigger will auto-insert that user as a
    -- joined participant with is_host=true. We then set team_number=1 on
    -- that auto-created row and explicitly insert player 2 with team 2.
    -- visibility='private' suppresses the notify-nearby-players trigger.
    INSERT INTO match (
        sport_id, match_date, start_time, end_time, player_expectation,
        location_name, location_address, notes, created_by,
        timezone, visibility
    )
    VALUES (
        v_t.sport_id, v_match_date, v_start_time, v_end_time, 'competitive',
        v_t.venue_name, v_t.venue_address, v_notes, v_p1_user,
        'America/Toronto', 'private'
    )
    RETURNING id INTO v_match_id;

    UPDATE match_participant
       SET team_number = 1
     WHERE match_id  = v_match_id
       AND player_id = v_p1_user;

    INSERT INTO match_participant (match_id, player_id, team_number, status, joined_at)
    VALUES (v_match_id, v_p2_user, 2, 'joined', now());

    UPDATE tournament_matches
       SET match_id   = v_match_id,
           updated_at = now()
     WHERE id = p_tm_id;

    RETURN v_match_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lt_create_match_for_tournament_match(uuid) TO authenticated;


-- =====================
-- 3. Bypass time gates for tournament-linked matches
-- =====================
-- The 5-arg submit_match_result_for_match (added in 20260311... for doubles
-- support) enforces "match must have ended" and "within 48h after end".
-- Tournament matches are scored as soon as they're played regardless of
-- the placeholder scheduled date — skip both gates when the linked
-- tournament_match exists. The body is otherwise verbatim from the
-- current production version.
--
-- The older 4-arg variant from 20260205000000 is superseded and unused;
-- drop it so postgrest can dispatch the 4-arg call signature unambiguously.

DROP FUNCTION IF EXISTS public.submit_match_result_for_match(uuid, uuid, integer, jsonb);

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
  v_is_tournament_linked   BOOLEAN;
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

  -- Time gates — bypassed for tournament-linked matches whose end_time
  -- and match_date are placeholders set by lt_create_match_for_tournament_match.
  SELECT EXISTS (SELECT 1 FROM tournament_matches WHERE match_id = p_match_id)
    INTO v_is_tournament_linked;

  IF NOT v_is_tournament_linked THEN
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
-- 4. Advancement: when match_result.is_verified flips true, propagate
-- =====================
-- Walks the bracket forward from the just-completed tournament_match,
-- filling next-round slots, auto-creating downstream match rows when both
-- slots become real, and auto-completing winner-vs-phantom-BYE matches
-- (mirrors the V3 generator's BYE handling). Marks the tournament
-- 'completed' when the final match has a winner.

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

    -- First non-BYE completion locks the bracket against structural edits
    IF v_tournament.bracket_locked_at IS NULL THEN
        UPDATE tournaments
           SET bracket_locked_at = now(),
               updated_at        = now()
         WHERE id = v_tournament.id;
    END IF;

    -- Walk forward
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
            -- Phantom-fed slot → auto-complete and continue propagating
            UPDATE tournament_matches
               SET winner_registration_id = v_curr_winner,
                   status                 = 'completed',
                   version                = version + 1,
                   updated_at             = now()
             WHERE id = v_next.id
            RETURNING * INTO v_next;

            v_curr := v_next;
            -- v_curr_winner unchanged
        ELSE
            -- Both slots have determinate occupants? → playable now → create the match
            IF v_next.player1_registration_id IS NOT NULL
               AND v_next.player2_registration_id IS NOT NULL
               AND NOT v_next.player1_is_bye
               AND NOT v_next.player2_is_bye
               AND v_next.match_id IS NULL THEN
                PERFORM public.lt_create_match_for_tournament_match(v_next.id);
            END IF;
            EXIT;
        END IF;
    END LOOP;

    -- Final completion → tournament completed
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
-- 5. Trigger on match_result.is_verified
-- =====================

CREATE OR REPLACE FUNCTION public.lt_match_result_propagation_tg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_tm           tournament_matches;
    v_winner_user  uuid;
    v_winner_reg   uuid;
    v_score_text   text;
BEGIN
    -- Only fire on verified flips
    IF NEW.is_verified IS NOT TRUE THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.is_verified IS TRUE THEN
        RETURN NEW;
    END IF;

    -- Find the linked tournament_match (if any)
    SELECT * INTO v_tm FROM tournament_matches WHERE match_id = NEW.match_id;
    IF v_tm.id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Skip if already completed (defensive)
    IF v_tm.status = 'completed' THEN
        RETURN NEW;
    END IF;

    -- Translate winning_team (1|2) → registration_id by participant team
    SELECT mp.player_id INTO v_winner_user
      FROM match_participant mp
     WHERE mp.match_id    = NEW.match_id
       AND mp.team_number = NEW.winning_team
     LIMIT 1;

    IF v_winner_user IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT id INTO v_winner_reg
      FROM tournament_registrations
     WHERE tournament_id = v_tm.tournament_id
       AND user_id       = v_winner_user;

    IF v_winner_reg IS NULL THEN
        RETURN NEW;
    END IF;

    -- Build a compact score string from the per-set rows (e.g. "6-4 6-2")
    SELECT string_agg(s.team1_score || '-' || s.team2_score, ' ' ORDER BY s.set_number)
      INTO v_score_text
      FROM match_set s
     WHERE s.match_result_id = NEW.id;

    -- Complete the tournament_match
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
        coalesce(NEW.confirmed_by, NEW.submitted_by),
        jsonb_build_object(
            'tournament_id', v_tm.tournament_id,
            'round', v_tm.round_number,
            'position', v_tm.match_position,
            'winner_registration_id', v_winner_reg,
            'score', v_score_text,
            'match_result_id', NEW.id
        )
    );

    -- Walk the bracket
    PERFORM public.lt_advance_tournament_winner(v_tm.id, v_winner_reg);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lt_match_result_propagation ON match_result;
CREATE TRIGGER lt_match_result_propagation
AFTER INSERT OR UPDATE OF is_verified ON match_result
FOR EACH ROW
EXECUTE FUNCTION public.lt_match_result_propagation_tg();


-- =====================
-- 6. Trigger on tournament_matches: auto-create match row when both slots fill
-- =====================
-- generate_bracket builds round 1 with player slots already assigned, and
-- the advance helper fills downstream slots. This trigger is the safety
-- net for any other code path (manual swap, future RPCs) that fills both
-- slots — it ensures the standalone match row exists.

CREATE OR REPLACE FUNCTION public.lt_tournament_match_autocreate_match_tg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.match_id IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.status <> 'pending' THEN
        RETURN NEW;
    END IF;
    IF NEW.player1_is_bye OR NEW.player2_is_bye THEN
        RETURN NEW;
    END IF;
    IF NEW.player1_registration_id IS NULL OR NEW.player2_registration_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM public.lt_create_match_for_tournament_match(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lt_tournament_match_autocreate_match ON tournament_matches;
CREATE TRIGGER lt_tournament_match_autocreate_match
AFTER INSERT OR UPDATE OF player1_registration_id, player2_registration_id, status ON tournament_matches
FOR EACH ROW
EXECUTE FUNCTION public.lt_tournament_match_autocreate_match_tg();
