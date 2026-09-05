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

-- Section 9: the contest window is the only counterweight to a score that is
-- final on entry, and it is what Jean is asked to look for.
UPDATE match_result mr SET confirmation_deadline = now() + interval '48 hours'
  FROM pairing pr WHERE mr.match_id = pr.match_id AND pr.has_score;

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

SELECT pr.id,
       b.tentative_until,
       (SELECT confirmation_deadline FROM match_result WHERE match_id = pr.match_id) AS contest_until,
       (SELECT count(*) FROM message x
          JOIN conversation c ON c.id = x.conversation_id
         WHERE c.tournament_match_id = pr.id AND x.message_type = 'match_organizer') AS cards
  FROM pairing pr LEFT JOIN lt_pairing_booking b ON b.tournament_match_id = pr.id;

COMMIT;
