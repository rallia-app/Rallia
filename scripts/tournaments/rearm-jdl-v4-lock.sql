-- Re-arm section 1.2 of the funnel retest: the locked pool-room composer.
--
-- The lock is the most opinionated thing in the release and nobody has seen
-- it. Jean answered the gate on [JDL v4] Le parcours before reading the guide,
-- so on 2026-09-02 the room was already open. Withdrawing his answer for that
-- phase puts him back in front of the wall; his two ready opponents keep
-- theirs, so the board still reads "Prêt à planifier" for them once he is in.
--
-- Idempotent. Run alongside restamp-jdl-v4-entente.sql the day he tests:
--   npm run db:rearm:jdl-retest
BEGIN;

-- Same clock as L'entente: the pool deadline lapsed the night of 2026-09-14
-- and the ladder settled the whole pool at 04:00 UTC. A week out, and the
-- settled pairings back on the board.
UPDATE tournament_round_deadlines d
   SET deadline_at = now() + interval '7 days'
  FROM tournaments t
 WHERE d.tournament_id = t.id AND t.name = '[JDL v4] Le parcours'
   AND d.bracket_side = 'pool' AND d.deadline_at < now() + interval '3 days';

CREATE TEMP TABLE unsettled ON COMMIT DROP AS
SELECT tm.id
  FROM tournament_matches tm
  JOIN tournaments t ON t.id = tm.tournament_id
 WHERE t.name = '[JDL v4] Le parcours' AND tm.bracket_side = 'pool'
   AND tm.status IN ('walkover', 'cancelled');

UPDATE tournament_matches tm
   SET status = 'pending', winner_registration_id = NULL, score = NULL,
       played_at = NULL, deadline_override_at = NULL,
       version = version + 1, updated_at = now()
  FROM unsettled u WHERE tm.id = u.id;

DELETE FROM reputation_event re
 USING unsettled u
 WHERE (re.metadata ->> 'tournamentMatchId')::uuid = u.id;

INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
SELECT 'tournament_match', u.id, 'restore', 'a11a0000-0000-4000-8000-000000000001'::uuid,
       jsonb_build_object('automatic', true, 'misfire', false, 'via', 'rearm')
  FROM unsettled u;

WITH j AS (SELECT id FROM auth.users WHERE email = 'jdl.sonkin@gmail.com'),
     t AS (SELECT id FROM tournaments WHERE name = '[JDL v4] Le parcours')
DELETE FROM tournament_phase_availability a
 USING j, t
 WHERE a.tournament_id = t.id AND a.player_id = j.id
   AND a.bracket_side = 'pool' AND a.round_number = 0;

-- The gate stamps the bookings it unlocked; none should survive the reset or
-- the pairing rooms open on a card he never earned.
WITH j AS (SELECT id FROM auth.users WHERE email = 'jdl.sonkin@gmail.com'),
     t AS (SELECT id FROM tournaments WHERE name = '[JDL v4] Le parcours')
DELETE FROM lt_pairing_booking b
 USING tournament_matches tm, tournament_registrations r, j, t
 WHERE b.tournament_match_id = tm.id AND tm.tournament_id = t.id
   AND r.id IN (tm.player1_registration_id, tm.player2_registration_id)
   AND r.user_id = j.id;

-- jean_organises must read false: the lock exempts the organizer, so a
-- tournament he organizes can never show it to him.
SELECT t.name,
       (t.organizer_id = (SELECT id FROM auth.users WHERE email = 'jdl.sonkin@gmail.com'))
         AS jean_organises,
       NOT EXISTS (SELECT 1 FROM tournament_phase_availability a
                    WHERE a.tournament_id = t.id
                      AND a.player_id = (SELECT id FROM auth.users WHERE email = 'jdl.sonkin@gmail.com'))
         AS jean_locked_out,
       (SELECT count(DISTINCT a.player_id) FROM tournament_phase_availability a
         WHERE a.tournament_id = t.id) AS others_answered,
       (SELECT deadline_at FROM tournament_round_deadlines d
         WHERE d.tournament_id = t.id AND d.bracket_side = 'pool') AS phase_deadline,
       (SELECT count(*) FROM tournament_matches tm
         WHERE tm.tournament_id = t.id AND tm.status = 'pending') AS a_jouer
  FROM tournaments t WHERE t.name = '[JDL v4] Le parcours';

COMMIT;
