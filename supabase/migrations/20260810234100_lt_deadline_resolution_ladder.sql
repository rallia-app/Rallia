-- Round deadlines — F4b: nudges + the resolution ladder (spec:
-- specs/17-leagues-tournaments/round-deadlines.md, pool-phase aware).
--
--   * Nudges: T-48h to both sides of an unresolved match with no attached
--     game; T-12h only to players who haven't voted on any organizer-card
--     option. Deduped by stamps on the match row.
--   * Ladder (lt_resolve_due_tournament_matches, cron every 15 min, FREE
--     tournaments only): a scheduled game earns one automatic grace
--     (game time + 72h); disputes escalate to the organizer and stop the
--     ladder; otherwise effort (votes, self-posted organizer card, any
--     round-chat message) decides: one side effortful → walkover; neither →
--     double walkover; both → one loud automatic extension (72h, capped at
--     end_date), then double walkover. Every automated decision writes the
--     effort evidence to the audit table. p_dry_run audits the decision it
--     WOULD take (action prefixed 'dryrun_') without acting.
--   * Double walkover: no winner; on the main side the fed slot becomes a
--     bye so the existing phantom machinery cascades; a final that double
--     walkovers completes the tournament with no champion. Pool rows just
--     settle (standings already treat a winnerless walkover as no points).
--   * Reputation: walkover losers get tournament_unresponsive (-15,
--     decaying like report_upheld). Rating is never touched; no
--     match_result is synthesized.

-- ============================================
-- DDL: nudge stamps + reputation config
-- ============================================

ALTER TABLE tournament_matches
    ADD COLUMN IF NOT EXISTS deadline_nudge48_at timestamptz,
    ADD COLUMN IF NOT EXISTS deadline_nudge12_at timestamptz;

INSERT INTO reputation_config
    (event_type, default_impact, min_impact, max_impact, decay_enabled, decay_half_life_days, is_active)
VALUES ('tournament_unresponsive', -15, -15, -15, true, 90, true)
ON CONFLICT (event_type) DO NOTHING;

-- ============================================
-- Effective deadline helper
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_effective_match_deadline(p_tm tournament_matches)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        p_tm.deadline_override_at,
        (SELECT trd.deadline_at
           FROM tournament_round_deadlines trd
          WHERE trd.tournament_id = p_tm.tournament_id
            AND trd.bracket_side  = p_tm.bracket_side
            AND trd.round_number  = CASE WHEN p_tm.bracket_side = 'pool'
                                         THEN 0 ELSE p_tm.round_number END)
    );
$$;

-- ============================================
-- lt_side_users / lt_side_effort — effort evidence for one side of a match
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_registration_users(p_reg uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
AS $$
    SELECT array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)
      FROM tournament_registrations r WHERE r.id = p_reg;
$$;

CREATE OR REPLACE FUNCTION public.lt_side_effort(p_tm_id uuid, p_users uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'voted', EXISTS (
            SELECT 1 FROM match_time_vote v
              JOIN message m       ON m.id = v.message_id
              JOIN conversation c  ON c.id = m.conversation_id
             WHERE c.tournament_match_id = p_tm_id
               AND v.player_id = ANY (p_users)),
        'posted_card', EXISTS (
            SELECT 1 FROM message m
              JOIN conversation c ON c.id = m.conversation_id
             WHERE c.tournament_match_id = p_tm_id
               AND m.message_type = 'match_organizer'
               AND m.sender_id = ANY (p_users)),
        'messaged', EXISTS (
            SELECT 1 FROM message m
              JOIN conversation c ON c.id = m.conversation_id
             WHERE c.tournament_match_id = p_tm_id
               AND m.deleted_at IS NULL
               AND m.sender_id = ANY (p_users))
    );
$$;

-- ============================================
-- lt_advance_double_walkover
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_advance_double_walkover(p_tm_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm    tournament_matches;
    v_next  tournament_matches;
    v_other uuid;
    v_other_bye boolean;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id FOR UPDATE;
    IF v_tm.id IS NULL OR v_tm.status NOT IN ('pending', 'in_progress', 'disputed') THEN
        RETURN;
    END IF;

    UPDATE tournament_matches
       SET status                 = 'walkover',
           winner_registration_id = NULL,
           score                  = 'W/O-W/O',
           played_at              = now(),
           version                = version + 1,
           updated_at             = now()
     WHERE id = p_tm_id;

    IF v_tm.bracket_side <> 'main' OR v_tm.next_match_id IS NULL THEN
        -- Pool row (standings treat it as no points for anyone), or a final:
        -- a final with no winner completes the tournament with no champion.
        IF v_tm.bracket_side = 'main' AND v_tm.next_match_id IS NULL THEN
            UPDATE tournaments
               SET status = 'completed', version = version + 1, updated_at = now()
             WHERE id = v_tm.tournament_id AND status = 'in_progress';
        END IF;
        RETURN;
    END IF;

    -- Feed the next slot as a bye and let the phantom machinery cascade.
    SELECT * INTO v_next FROM tournament_matches WHERE id = v_tm.next_match_id FOR UPDATE;
    IF v_tm.next_match_slot = 1 THEN
        UPDATE tournament_matches
           SET player1_registration_id = NULL, player1_is_bye = true,
               version = version + 1, updated_at = now()
         WHERE id = v_next.id;
        v_other     := v_next.player2_registration_id;
        v_other_bye := v_next.player2_is_bye;
    ELSE
        UPDATE tournament_matches
           SET player2_registration_id = NULL, player2_is_bye = true,
               version = version + 1, updated_at = now()
         WHERE id = v_next.id;
        v_other     := v_next.player1_registration_id;
        v_other_bye := v_next.player1_is_bye;
    END IF;

    IF v_other IS NOT NULL AND NOT v_other_bye THEN
        -- Real opponent sails through on the bye.
        UPDATE tournament_matches
           SET winner_registration_id = v_other, status = 'completed',
               version = version + 1, updated_at = now()
         WHERE id = v_next.id;
        PERFORM public.lt_advance_tournament_winner(v_next.id, v_other);
    ELSIF v_other_bye THEN
        -- Bye vs bye: the dead sub-bracket cascades.
        PERFORM public.lt_advance_double_walkover(v_next.id);
    END IF;
    -- Other slot still TBD: when its feeder resolves, the normal advance
    -- path auto-completes against the bye.
END;
$$;

-- ============================================
-- lt_send_tournament_deadline_nudges — cron, every 30 min
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_send_tournament_deadline_nudges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec  record;
    v_rows jsonb;
    v_sent integer := 0;
    v_eff  timestamptz;
BEGIN
    FOR v_rec IN
        SELECT tm.*, t.name AS t_name
          FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id
         WHERE t.status = 'in_progress'
           AND tm.status IN ('pending', 'in_progress')
           AND tm.match_id IS NULL
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
           AND (tm.deadline_nudge48_at IS NULL OR tm.deadline_nudge12_at IS NULL)
    LOOP
        v_eff := public.lt_effective_match_deadline(
            (SELECT m FROM tournament_matches m WHERE m.id = v_rec.id));
        CONTINUE WHEN v_eff IS NULL OR v_eff <= now();

        IF v_rec.deadline_nudge12_at IS NULL AND v_eff <= now() + interval '12 hours' THEN
            SELECT jsonb_agg(jsonb_build_object(
                'user_id', u.uid,
                'type', 'tournament_round_deadline_soon',
                'target_id', v_rec.tournament_id,
                'title', CASE WHEN public.lt_user_is_fr(u.uid)
                           THEN 'Dernière chance' ELSE 'Last chance' END,
                'body', CASE WHEN public.lt_user_is_fr(u.uid)
                          THEN v_rec.t_name || ' : ta partie sera déclarée forfait à l''échéance si vous ne choisissez pas un moment pour jouer.'
                          ELSE v_rec.t_name || ': your game will be forfeited at the deadline unless you pick a time to play.'
                        END,
                'payload', jsonb_build_object(
                    'tournamentId', v_rec.tournament_id,
                    'tournamentMatchId', v_rec.id,
                    'tier', '12h',
                    'deadlineAt', v_eff
                ),
                'priority', 'high'
            ))
            INTO v_rows
            FROM (
                SELECT unnest(public.lt_registration_users(v_rec.player1_registration_id)
                           || public.lt_registration_users(v_rec.player2_registration_id)) AS uid
            ) u
            WHERE NOT EXISTS (
                SELECT 1 FROM match_time_vote v
                  JOIN message m      ON m.id = v.message_id
                  JOIN conversation c ON c.id = m.conversation_id
                 WHERE c.tournament_match_id = v_rec.id
                   AND v.player_id = u.uid);

            IF v_rows IS NOT NULL THEN
                PERFORM insert_notifications(v_rows);
                v_sent := v_sent + jsonb_array_length(v_rows);
            END IF;
            UPDATE tournament_matches
               SET deadline_nudge12_at = now(),
                   deadline_nudge48_at = COALESCE(deadline_nudge48_at, now())
             WHERE id = v_rec.id;

        ELSIF v_rec.deadline_nudge48_at IS NULL AND v_eff <= now() + interval '48 hours' THEN
            SELECT jsonb_agg(jsonb_build_object(
                'user_id', u.uid,
                'type', 'tournament_round_deadline_soon',
                'target_id', v_rec.tournament_id,
                'title', CASE WHEN public.lt_user_is_fr(u.uid)
                           THEN '48 h pour jouer ta partie' ELSE '48h left to play your game' END,
                'body', CASE WHEN public.lt_user_is_fr(u.uid)
                          THEN v_rec.t_name || ' : il reste 48 h pour organiser et jouer ta partie contre ' || u.opp || '.'
                          ELSE v_rec.t_name || ': 48h left to organize and play your game vs ' || u.opp || '.'
                        END,
                'payload', jsonb_build_object(
                    'tournamentId', v_rec.tournament_id,
                    'tournamentMatchId', v_rec.id,
                    'tier', '48h',
                    'deadlineAt', v_eff
                ),
                'priority', 'normal'
            ))
            INTO v_rows
            FROM (
                SELECT unnest(public.lt_registration_users(v_rec.player1_registration_id)) AS uid,
                       public.lt_registration_display_name(v_rec.player2_registration_id) AS opp
                UNION ALL
                SELECT unnest(public.lt_registration_users(v_rec.player2_registration_id)),
                       public.lt_registration_display_name(v_rec.player1_registration_id)
            ) u;

            IF v_rows IS NOT NULL THEN
                PERFORM insert_notifications(v_rows);
                v_sent := v_sent + jsonb_array_length(v_rows);
            END IF;
            UPDATE tournament_matches
               SET deadline_nudge48_at = now()
             WHERE id = v_rec.id;
        END IF;
    END LOOP;

    RETURN v_sent;
END;
$$;

-- ============================================
-- lt_resolve_due_tournament_matches — cron, every 15 min, FREE tournaments
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_resolve_due_tournament_matches(p_dry_run boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec       record;
    v_eff       timestamptz;
    v_grace     timestamptz;
    v_e1        jsonb;
    v_e2        jsonb;
    v_has1      boolean;
    v_has2      boolean;
    v_winner    uuid;
    v_loser     uuid;
    v_acted     integer := 0;
    v_prefix    text := CASE WHEN p_dry_run THEN 'dryrun_' ELSE '' END;
    v_rows      jsonb;
    v_uid       uuid;
BEGIN
    FOR v_rec IN
        SELECT tm.*, t.name AS t_name, t.end_date AS t_end, t.organizer_id AS t_org
          FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id
         WHERE t.status = 'in_progress'
           AND t.entry_fee_cents = 0
           AND tm.status IN ('pending', 'in_progress', 'disputed')
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
         FOR UPDATE OF tm SKIP LOCKED
    LOOP
        v_eff := public.lt_effective_match_deadline(
            (SELECT m FROM tournament_matches m WHERE m.id = v_rec.id));
        CONTINUE WHEN v_eff IS NULL OR v_eff > now();

        -- Disputes are never auto-resolved: escalate once, wait.
        IF v_rec.status = 'disputed' THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('dispute_escalated', 'dryrun_dispute_escalated')
            ) THEN
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'dispute_escalated', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id, 'deadline_at', v_eff));
                IF NOT p_dry_run THEN
                    SELECT jsonb_agg(jsonb_build_object(
                        'user_id', o.organizer_id,
                        'type', 'tournament_dispute_escalated',
                        'target_id', v_rec.tournament_id,
                        'title', CASE WHEN public.lt_user_is_fr(o.organizer_id)
                                   THEN 'Litige à trancher' ELSE 'Dispute needs a ruling' END,
                        'body', CASE WHEN public.lt_user_is_fr(o.organizer_id)
                                  THEN v_rec.t_name || ' : une partie contestée a dépassé son échéance et attend ta décision.'
                                  ELSE v_rec.t_name || ': a disputed game passed its deadline and awaits your ruling.'
                                END,
                        'payload', jsonb_build_object(
                            'tournamentId', v_rec.tournament_id,
                            'tournamentMatchId', v_rec.id),
                        'priority', 'high'
                    )) INTO v_rows
                    FROM (SELECT t.organizer_id FROM tournaments t WHERE t.id = v_rec.tournament_id) o;
                    IF v_rows IS NOT NULL THEN
                        PERFORM insert_notifications(v_rows);
                    END IF;
                END IF;
                v_acted := v_acted + 1;
            END IF;
            CONTINUE;
        END IF;

        -- Step 0: an attached game is mutual agreement → one automatic grace.
        IF v_rec.match_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('auto_grace', 'dryrun_auto_grace')
            ) THEN
                SELECT GREATEST(
                           (m.match_date + COALESCE(m.start_time, time '20:00'))::timestamptz
                               + interval '72 hours',
                           now() + interval '24 hours')
                  INTO v_grace
                  FROM match m WHERE m.id = v_rec.match_id;
                IF v_grace IS NOT NULL THEN
                    IF NOT p_dry_run THEN
                        UPDATE tournament_matches
                           SET deadline_override_at = v_grace,
                               version = version + 1, updated_at = now()
                         WHERE id = v_rec.id;
                    END IF;
                    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                    VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_grace', v_rec.t_org,
                            jsonb_build_object('tournament_id', v_rec.tournament_id,
                                               'grace_until', v_grace));
                    v_acted := v_acted + 1;
                END IF;
            END IF;
            -- Grace already granted and expired with a game still attached:
            -- leave it to the score/auto-confirm path and the organizer.
            CONTINUE;
        END IF;

        -- Step 1: effort split.
        v_e1 := public.lt_side_effort(v_rec.id, public.lt_registration_users(v_rec.player1_registration_id));
        v_e2 := public.lt_side_effort(v_rec.id, public.lt_registration_users(v_rec.player2_registration_id));
        v_has1 := (v_e1->>'voted')::boolean OR (v_e1->>'posted_card')::boolean OR (v_e1->>'messaged')::boolean;
        v_has2 := (v_e2->>'voted')::boolean OR (v_e2->>'posted_card')::boolean OR (v_e2->>'messaged')::boolean;

        IF v_has1 AND v_has2 THEN
            IF EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('auto_extension', 'dryrun_auto_extension')
            ) THEN
                v_winner := NULL;  -- extension spent → double walkover below
            ELSE
                IF NOT p_dry_run THEN
                    UPDATE tournament_matches
                       SET deadline_override_at = LEAST(now() + interval '72 hours',
                                                        GREATEST(v_rec.t_end, now() + interval '48 hours')),
                           version = version + 1, updated_at = now()
                     WHERE id = v_rec.id;
                    SELECT jsonb_agg(jsonb_build_object(
                        'user_id', u.uid,
                        'type', 'tournament_deadline_extended',
                        'target_id', v_rec.tournament_id,
                        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                                   THEN 'Prolongation automatique' ELSE 'Automatic extension' END,
                        'body', CASE WHEN public.lt_user_is_fr(u.uid)
                                  THEN v_rec.t_name || ' : vous cherchez tous les deux un moment. Dernière prolongation, ensuite la partie est annulée pour les deux.'
                                  ELSE v_rec.t_name || ': you are both trying to find a time. One last extension, then the game is voided for both.'
                                END,
                        'payload', jsonb_build_object(
                            'tournamentId', v_rec.tournament_id,
                            'tournamentMatchId', v_rec.id),
                        'priority', 'high'
                    )) INTO v_rows
                    FROM (SELECT unnest(public.lt_registration_users(v_rec.player1_registration_id)
                                     || public.lt_registration_users(v_rec.player2_registration_id)) AS uid) u;
                    IF v_rows IS NOT NULL THEN
                        PERFORM insert_notifications(v_rows);
                    END IF;
                END IF;
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_extension', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id,
                                           'effort_p1', v_e1, 'effort_p2', v_e2));
                v_acted := v_acted + 1;
                CONTINUE;
            END IF;
        END IF;

        IF v_has1 <> v_has2 THEN
            -- One-sided effort → walkover for the effortful side.
            IF v_has1 THEN
                v_winner := v_rec.player1_registration_id;
                v_loser  := v_rec.player2_registration_id;
            ELSE
                v_winner := v_rec.player2_registration_id;
                v_loser  := v_rec.player1_registration_id;
            END IF;

            INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
            VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_walkover', v_rec.t_org,
                    jsonb_build_object('tournament_id', v_rec.tournament_id,
                                       'winner_registration_id', v_winner,
                                       'effort_p1', v_e1, 'effort_p2', v_e2));
            IF NOT p_dry_run THEN
                UPDATE tournament_matches
                   SET status = 'walkover', winner_registration_id = v_winner,
                       score = 'W/O', played_at = now(),
                       version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_advance_tournament_winner(v_rec.id, v_winner);
                FOREACH v_uid IN ARRAY public.lt_registration_users(v_loser) LOOP
                    INSERT INTO reputation_event
                        (player_id, event_type, base_impact, metadata, event_occurred_at)
                    VALUES (v_uid, 'tournament_unresponsive', -15,
                            jsonb_build_object('tournamentId', v_rec.tournament_id,
                                               'tournamentMatchId', v_rec.id), now());
                END LOOP;
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, v_winner, false);
            END IF;
            v_acted := v_acted + 1;
        ELSE
            -- Neither side (or extension spent) → double walkover.
            INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
            VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_double_walkover', v_rec.t_org,
                    jsonb_build_object('tournament_id', v_rec.tournament_id,
                                       'effort_p1', v_e1, 'effort_p2', v_e2));
            IF NOT p_dry_run THEN
                PERFORM public.lt_advance_double_walkover(v_rec.id);
                FOREACH v_uid IN ARRAY (public.lt_registration_users(v_rec.player1_registration_id)
                                     || public.lt_registration_users(v_rec.player2_registration_id)) LOOP
                    INSERT INTO reputation_event
                        (player_id, event_type, base_impact, metadata, event_occurred_at)
                    VALUES (v_uid, 'tournament_unresponsive', -15,
                            jsonb_build_object('tournamentId', v_rec.tournament_id,
                                               'tournamentMatchId', v_rec.id), now());
                END LOOP;
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, NULL, true);
            END IF;
            v_acted := v_acted + 1;
        END IF;
    END LOOP;

    RETURN v_acted;
END;
$$;

-- ============================================
-- lt_notify_tournament_walkover
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_notify_tournament_walkover(
    p_tm_id  uuid,
    p_winner uuid,
    p_double boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm   tournament_matches;
    v_t    tournaments;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id;
    SELECT * INTO v_t  FROM tournaments WHERE id = v_tm.tournament_id;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.uid,
        'type', 'tournament_match_walkover',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                   THEN 'Partie réglée par forfait' ELSE 'Game settled by walkover' END,
        'body', CASE
                  WHEN p_double AND public.lt_user_is_fr(u.uid)
                    THEN v_t.name || ' : la partie n''a pas été jouée avant l''échéance. Personne n''avance.'
                  WHEN p_double
                    THEN v_t.name || ': the game was not played before the deadline. Nobody advances.'
                  WHEN u.won AND public.lt_user_is_fr(u.uid)
                    THEN v_t.name || ' : ton adversaire n''a pas donné suite avant l''échéance. Tu avances par forfait.'
                  WHEN u.won
                    THEN v_t.name || ': your opponent did not respond before the deadline. You advance by walkover.'
                  WHEN public.lt_user_is_fr(u.uid)
                    THEN v_t.name || ' : la partie a été déclarée forfait à l''échéance parce qu''aucun moment n''a été convenu de ton côté.'
                  ELSE v_t.name || ': the game was forfeited at the deadline because no time was agreed on your side.'
                END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentMatchId', v_tm.id,
            'double', p_double
        ),
        'priority', 'high'
    ))
    INTO v_rows
    FROM (
        SELECT unnest(public.lt_registration_users(v_tm.player1_registration_id)) AS uid,
               (v_tm.player1_registration_id = p_winner) AS won
        UNION ALL
        SELECT unnest(public.lt_registration_users(v_tm.player2_registration_id)),
               (v_tm.player2_registration_id = p_winner)
    ) u;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;

-- ============================================
-- Cron wiring + privileges. Cron-only: not callable by app roles.
-- ============================================

REVOKE ALL ON FUNCTION public.lt_send_tournament_deadline_nudges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lt_advance_double_walkover(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lt_notify_tournament_walkover(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('lt-tournament-deadline-nudges') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-tournament-deadline-nudges'
);
SELECT cron.schedule(
  'lt-tournament-deadline-nudges',
  '*/30 * * * *',
  $$ SELECT public.lt_send_tournament_deadline_nudges(); $$
);

SELECT cron.unschedule('lt-tournament-deadline-resolver') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-tournament-deadline-resolver'
);
SELECT cron.schedule(
  'lt-tournament-deadline-resolver',
  '*/15 * * * *',
  $$ SELECT public.lt_resolve_due_tournament_matches(false); $$
);
