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

SELECT t.name,
       NOT EXISTS (SELECT 1 FROM tournament_phase_availability a
                    WHERE a.tournament_id = t.id
                      AND a.player_id = (SELECT id FROM auth.users WHERE email = 'jdl.sonkin@gmail.com'))
         AS jean_locked_out,
       (SELECT count(DISTINCT a.player_id) FROM tournament_phase_availability a
         WHERE a.tournament_id = t.id) AS others_answered
  FROM tournaments t WHERE t.name = '[JDL v4] Le parcours';

COMMIT;
