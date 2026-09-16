-- Re-arm the [JDL v4] L'entente fixture for sections 4, 5 and 9 of the funnel
-- retest guide.
--
-- Both mechanisms these sections test are real clocks: a booking is tentative
-- for 24 h and then silence confirms it, and a declared score is contestable
-- for 48 h. So the fixture goes stale on its own, and Jean's 2026-09-02 pass
-- lost three sections to a booking seeded on 08-31. Run this the same day he
-- tests, as often as needed; it is idempotent.
--
--   psql "$(cat supabase/.temp/pooler-url)" -f scripts/tournaments/restamp-jdl-v4-entente.sql
BEGIN;

-- The phase deadline is a clock too. On 2026-09-14 it had already passed, the
-- ladder had cancelled every pairing the day before, and re-stamping the
-- booking and the contest window re-armed nothing. Push it a week out and put
-- the pairings the ladder settled back on the board, leaving the audit trail
-- consistent so no pending pairing offers a restore.
UPDATE tournament_round_deadlines d
   SET deadline_at = now() + interval '7 days'
  FROM tournaments t
 WHERE d.tournament_id = t.id AND t.name = '[JDL v4] L''entente'
   AND d.bracket_side = 'pool' AND d.deadline_at < now() + interval '3 days';

CREATE TEMP TABLE unsettled ON COMMIT DROP AS
SELECT tm.id
  FROM tournament_matches tm
  JOIN tournaments t ON t.id = tm.tournament_id
 WHERE t.name = '[JDL v4] L''entente' AND tm.bracket_side = 'pool'
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

CREATE TEMP TABLE pairing ON COMMIT DROP AS
SELECT tm.id,
       tm.match_id,
       (tm.match_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = tm.match_id)) AS has_score,
       EXISTS (SELECT 1 FROM lt_pairing_booking b WHERE b.tournament_match_id = tm.id) AS has_booking
  FROM tournament_matches tm
  JOIN tournaments t ON t.id = tm.tournament_id
  JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
  JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
  JOIN profile p ON p.id IN (r1.user_id, r2.user_id) AND p.email = 'jdl.sonkin@gmail.com'
 WHERE t.name = '[JDL v4] L''entente' AND tm.bracket_side = 'pool';

-- Section 4: the game has to sit in the future, and its 24 h window has to be
-- running rather than lapsed.
UPDATE match m SET match_date = (now() + interval '3 days')::date
  FROM pairing pr WHERE m.id = pr.match_id AND pr.has_booking;

UPDATE lt_pairing_booking b
   SET booked_at = now() - interval '2 hours',
       tentative_until = now() + interval '22 hours',
       accepted_at = NULL, accepted_by = NULL
  FROM pairing pr WHERE b.tournament_match_id = pr.id;

-- Pairing rooms open when the gate trigger fires or when the app first taps
-- the pairing. The seed answers the gate in replica mode, so nothing opened
-- them, and on 2026-09-14 the booked pairing had no room for its card to
-- land in. Open Jean's three rooms here, and let the untouched pairing get
-- the real funnel card, which is where the forfeit control lives.
SELECT public.lt_get_or_create_tournament_round_chat_unchecked(pr.id) FROM pairing pr;
SELECT public.lt_post_system_match_organizer_card(pr.id)
  FROM pairing pr WHERE NOT pr.has_booking AND NOT pr.has_score;

-- The seed builds these games directly instead of through the card, so the
-- pairing room can end up with no card and nothing to render the tentative
-- band or the forfeit control on. Post one for the booked pairing, carrying
-- the slot that was actually booked.
UPDATE conversation c SET match_id = pr.match_id
  FROM pairing pr WHERE c.tournament_match_id = pr.id AND c.match_id IS NULL;

INSERT INTO message (conversation_id, sender_id, content, status, message_type, metadata)
SELECT c.id, 'a11a0000-0000-4000-8000-000000000001'::uuid,
       'Suggestions d''heures pour jouer · Suggested times to play', 'sent', 'match_organizer',
       jsonb_build_object(
         'kind', 'match_organizer', 'tournament_match_id', tm.id,
         'sport_id', t.sport_id, 'sport_name', COALESCE(s.display_name, initcap(s.name)),
         'format', CASE WHEN t.entry_format = 'singles' THEN 'singles' ELSE 'doubles' END,
         'participant_ids', to_jsonb(ARRAY[r1.user_id, r2.user_id]),
         'organizer_id', NULL, 'posted_by', 'system', 'silent', true, 'funnel', true,
         'options', jsonb_build_array(jsonb_build_object(
            'slot_start', ((m.match_date + m.start_time) AT TIME ZONE m.timezone),
            'day_label', to_char(m.match_date, 'Dy DD Mon'),
            'hour_of_day', extract(hour FROM m.start_time)::int,
            'facility_id', NULL, 'facility_name', NULL, 'court_name', NULL, 'court_count', 0,
            'price_cents', NULL, 'court_confirmed', false, 'court_state', 'untracked',
            'fav_count', 0, 'tier', 'usually_free', 'distance_km', NULL, 'free_count', 2,
            'option_key', md5(extract(epoch FROM ((m.match_date + m.start_time)
                                AT TIME ZONE m.timezone))::bigint::text || '|none'))),
         'created_match_id', m.id, 'confirmed_option_index', 0)
  FROM pairing pr
  JOIN tournament_matches tm ON tm.id = pr.id
  JOIN tournaments t ON t.id = tm.tournament_id
  JOIN sport s ON s.id = t.sport_id
  JOIN match m ON m.id = pr.match_id
  JOIN conversation c ON c.tournament_match_id = tm.id
  JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
  JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
 WHERE pr.has_booking
   AND NOT EXISTS (SELECT 1 FROM message x
                    WHERE x.conversation_id = c.id
                      AND x.message_type = 'match_organizer' AND x.deleted_at IS NULL);

-- The contest window is 12 h on a pairing now; a fixture re-stamped to 48 h
-- would tell Jean the wrong number.
UPDATE match_result mr SET confirmation_deadline = now() + public.lt_contest_window(pr.match_id)
  FROM pairing pr WHERE mr.match_id = pr.match_id AND pr.has_score;

-- Every row must read "pending" or "completed": a cancelled or walkover pairing
-- here means the re-arm did not take.
SELECT pr.id,
       tm.status,
       (SELECT deadline_at FROM tournament_round_deadlines d
         WHERE d.tournament_id = tm.tournament_id AND d.bracket_side = 'pool') AS phase_deadline,
       b.tentative_until,
       (SELECT confirmation_deadline FROM match_result WHERE match_id = pr.match_id) AS contest_until,
       EXISTS (SELECT 1 FROM conversation c WHERE c.tournament_match_id = pr.id) AS room,
       (SELECT count(*) FROM message x
          JOIN conversation c ON c.id = x.conversation_id
         WHERE c.tournament_match_id = pr.id AND x.message_type = 'match_organizer') AS cards
  FROM pairing pr
  JOIN tournament_matches tm ON tm.id = pr.id
  LEFT JOIN lt_pairing_booking b ON b.tournament_match_id = pr.id;

COMMIT;
