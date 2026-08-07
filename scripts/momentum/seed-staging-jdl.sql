-- ============================================================================
-- Momentum Harvesting: staging fixtures for jdl.sonkin@gmail.com
--
-- Idempotent AND re-armable. Every run wipes the [MOMENTUM] fixtures and
-- recreates the time-sensitive ones relative to now(). Re-run it whenever the
-- tester needs a fresh window: the unfilled-recovery push needs a game that
-- started in the last 6 h.
--
-- Run it in the Supabase SQL editor on rallia-staging (ahbaeewecdeguxtxtvhr).
--
-- Target: jdl.sonkin@gmail.com = 4ed1fa69-c3c4-4d24-83bf-948fb5a9a537
--   Cote Saint-Luc (45.4751, -73.6603), tennis NTRP 3.0, 30 km radius, fr-CA.
--
-- Everything sits at Parc Saint-Jean-de-Matha (5.7 km), the closest facility
-- whose bookable-slot snapshot runs several days out, which the court-booking
-- nudge needs.
--
-- The last-minute open-spots fixture was removed on 2026-08-07 when that
-- notification was switched off (see 20260807140000). If it is ever re-enabled,
-- its fixture has to sit within 5 km of the tester: its recipient gate is
-- LEAST(max_travel_distance, 5) km, and 5.7 km put him outside the cap.
--
-- session_replication_role = replica is deliberate: it suppresses
-- match_create_host_participant (we insert hosts ourselves) and
-- match_notify_nearby_players_on_create, whose pushes are noise for this test.
--
-- Cleanup: every match created here has notes LIKE '[MOMENTUM]%' and the
-- tournament is named '[MOMENTUM]%'.
-- ============================================================================

SET session_replication_role = replica;

-- ---------------------------------------------------------------- 0. reset --
DELETE FROM notification
 WHERE user_id = '4ed1fa69-c3c4-4d24-83bf-948fb5a9a537'
   AND type IN ('court_booking_nudge','match_last_minute_spots',
                'match_unfilled_recovery','play_rhythm_nudge',
                'tournament_registration_open');

DELETE FROM tournament_fanout_job
 WHERE tournament_id IN (SELECT id FROM tournaments WHERE name LIKE '[MOMENTUM]%');
DELETE FROM tournaments WHERE name LIKE '[MOMENTUM]%';

DELETE FROM match_participant
 WHERE match_id IN (SELECT id FROM match WHERE notes LIKE '[MOMENTUM]%');
DELETE FROM match WHERE notes LIKE '[MOMENTUM]%';

-- Let the nudges fire again on any game he created himself since yesterday.
UPDATE match SET booking_nudge_sent_at = NULL, unfilled_recovery_sent_at = NULL
 WHERE created_by = '4ed1fa69-c3c4-4d24-83bf-948fb5a9a537'
   AND match_date >= current_date - 1;

-- The play-rhythm sweep reads this flag. He must still grant the OS
-- permission in the app for a push to actually be delivered.
UPDATE player SET push_notifications_enabled = true
 WHERE id = '4ed1fa69-c3c4-4d24-83bf-948fb5a9a537';

-- A declared slot counts as fact for 14 days (tightened from 60 on 2026-08-07).
-- His schedule was last confirmed 2026-07-28, so it goes stale mid-test and the
-- play-rhythm nudge would silently stop firing. Re-arming refreshes it.
-- Testing the real path instead means having him re-save his availability
-- through the check-in flow, which bumps the same column.
UPDATE player_availability SET last_confirmed_at = now()
 WHERE player_id = '4ed1fa69-c3c4-4d24-83bf-948fb5a9a537';

-- ------------------------------------------- 1. invite-ranking badge signals --
-- Hugo Menard: played together 3x + favourite venue + free at the game hour.
INSERT INTO match (id, created_by, sport_id, match_date, start_time, end_time,
                   format, visibility, location_type, facility_id, timezone,
                   join_mode, is_auto_generated, notes)
SELECT v.id, 'a1000000-0000-0000-0000-000000000043',
       '36c45c46-1daf-48f2-b13a-cf7b2c961534',
       current_date - v.days_ago, '18:00', '19:30', 'singles', 'private',
       'facility', '04a0f958-3261-4169-9498-ca76ee6f4ec5', 'America/Toronto',
       'direct', false, '[MOMENTUM] partie jouee avec Hugo'
FROM (VALUES ('e1000000-0000-0000-0000-000000001001'::uuid, 60),
             ('e1000000-0000-0000-0000-000000001002'::uuid, 45),
             ('e1000000-0000-0000-0000-000000001003'::uuid, 30)) AS v(id, days_ago);

INSERT INTO match_participant (match_id, player_id, status, is_host, joined_at, responded_at)
SELECT m.id, p.player_id, 'joined', p.is_host, now() - interval '30 days', now() - interval '30 days'
FROM match m CROSS JOIN (VALUES
  ('a1000000-0000-0000-0000-000000000043'::uuid, true),
  ('4ed1fa69-c3c4-4d24-83bf-948fb5a9a537'::uuid, false)) AS p(player_id, is_host)
WHERE m.notes = '[MOMENTUM] partie jouee avec Hugo'
ON CONFLICT (match_id, player_id) DO NOTHING;

INSERT INTO player_favorite_facility (player_id, facility_id, sport_id)
VALUES ('a1000000-0000-0000-0000-000000000043',
        '04a0f958-3261-4169-9498-ca76ee6f4ec5',
        '36c45c46-1daf-48f2-b13a-cf7b2c961534')
ON CONFLICT DO NOTHING;

-- Hugo + Marie declared free Saturday 20h-21h, the slot of the game the tester
-- creates in scenario 2, so "Libre a l'heure du match" has something to prove.
INSERT INTO player_availability (player_id, day, hour_of_day, is_active, last_confirmed_at)
SELECT pid, 'saturday', h, true, now()
FROM (VALUES ('a1000000-0000-0000-0000-000000000043'::uuid),
             ('a1000000-0000-0000-0000-000000000008'::uuid)) AS p(pid),
     generate_series(20, 21) AS h
ON CONFLICT (player_id, day, hour_of_day)
DO UPDATE SET is_active = true, last_confirmed_at = now();

-- Alain Seguin: 4 human invites, all answered -> "Repond souvent".
-- requested_at stays NULL so they count as invites, not self-requests.
INSERT INTO match (id, created_by, sport_id, match_date, start_time, end_time,
                   format, visibility, location_type, facility_id, timezone,
                   join_mode, is_auto_generated, notes)
SELECT v.id, 'a1000000-0000-0000-0000-000000000043',
       '36c45c46-1daf-48f2-b13a-cf7b2c961534',
       current_date - v.days_ago, '19:00', '20:30', 'singles', 'private',
       'facility', '04a0f958-3261-4169-9498-ca76ee6f4ec5', 'America/Toronto',
       'direct', false, '[MOMENTUM] invitation repondue Alain'
FROM (VALUES ('e1000000-0000-0000-0000-000000002001'::uuid, 70),
             ('e1000000-0000-0000-0000-000000002002'::uuid, 55),
             ('e1000000-0000-0000-0000-000000002003'::uuid, 40),
             ('e1000000-0000-0000-0000-000000002004'::uuid, 25)) AS v(id, days_ago);

INSERT INTO match_participant (match_id, player_id, status, is_host, joined_at, responded_at)
SELECT m.id, p.player_id, 'joined', p.is_host, now() - interval '40 days', now() - interval '40 days'
FROM match m CROSS JOIN (VALUES
  ('a1000000-0000-0000-0000-000000000043'::uuid, true),
  ('a1000000-0000-0000-0000-000000000083'::uuid, false)) AS p(player_id, is_host)
WHERE m.notes = '[MOMENTUM] invitation repondue Alain'
ON CONFLICT (match_id, player_id) DO NOTHING;

-- Wei Chen: two games in the last 7 days -> "Actif cette semaine".
INSERT INTO match (id, created_by, sport_id, match_date, start_time, end_time,
                   format, visibility, location_type, facility_id, timezone,
                   join_mode, is_auto_generated, notes)
SELECT v.id, 'a1000000-0000-0000-0000-000000000033',
       '36c45c46-1daf-48f2-b13a-cf7b2c961534',
       current_date - v.days_ago, '18:00', '19:30', 'singles', 'private',
       'facility', '04a0f958-3261-4169-9498-ca76ee6f4ec5', 'America/Toronto',
       'direct', false, '[MOMENTUM] activite recente Wei'
FROM (VALUES ('e1000000-0000-0000-0000-000000003001'::uuid, 2),
             ('e1000000-0000-0000-0000-000000003002'::uuid, 5)) AS v(id, days_ago);

INSERT INTO match_participant (match_id, player_id, status, is_host, joined_at, responded_at)
SELECT m.id, 'a1000000-0000-0000-0000-000000000033', 'joined', true,
       now() - interval '2 days', now() - interval '2 days'
FROM match m WHERE m.notes = '[MOMENTUM] activite recente Wei'
ON CONFLICT (match_id, player_id) DO NOTHING;

-- -------------------------------- 2. match_unfilled_recovery (started -2h) --
INSERT INTO match (id, created_by, sport_id, match_date, start_time, end_time,
                   format, visibility, location_type, facility_id, timezone,
                   join_mode, is_auto_generated, notes)
VALUES ('e1000000-0000-0000-0000-000000000002',
        '4ed1fa69-c3c4-4d24-83bf-948fb5a9a537',
        '36c45c46-1daf-48f2-b13a-cf7b2c961534',
        ((now() AT TIME ZONE 'America/Toronto') - interval '2 hours')::date,
        date_trunc('hour', (now() AT TIME ZONE 'America/Toronto') - interval '2 hours')::time,
        date_trunc('hour', (now() AT TIME ZONE 'America/Toronto') - interval '30 minutes')::time,
        'singles', 'public', 'facility',
        '04a0f958-3261-4169-9498-ca76ee6f4ec5', 'America/Toronto',
        'direct', false, '[MOMENTUM] partie restee incomplete');

INSERT INTO match_participant (match_id, player_id, status, is_host, joined_at)
VALUES ('e1000000-0000-0000-0000-000000000002',
        '4ed1fa69-c3c4-4d24-83bf-948fb5a9a537', 'joined', true, now() - interval '3 hours');

-- ------------------------------------------------ 3. play_rhythm_nudge --
-- One game on each of his declared weekend slots, so the daily 13:00 UTC sweep
-- finds a target whether "tomorrow" is Saturday or Sunday. min_rating_score_id
-- must equal his own NTRP 3.0 score id for the compatibility join to hit.
INSERT INTO match (id, created_by, sport_id, match_date, start_time, end_time,
                   format, visibility, location_type, facility_id, timezone,
                   join_mode, is_auto_generated, min_rating_score_id, notes)
SELECT v.id, v.host, '36c45c46-1daf-48f2-b13a-cf7b2c961534', v.d,
       '16:00', '17:30', 'singles', 'public', 'facility',
       '04a0f958-3261-4169-9498-ca76ee6f4ec5', 'America/Toronto',
       'direct', false, '6dc7fa22-7286-4ce3-ba80-b0b56eb446ee',
       '[MOMENTUM] partie compatible pour le rythme de jeu'
FROM (VALUES
  ('e1000000-0000-0000-0000-000000000003'::uuid,
   'a1000000-0000-0000-0000-000000000083'::uuid,
   (date_trunc('week', current_date) + interval '5 days')::date),
  ('e1000000-0000-0000-0000-000000000004'::uuid,
   'a1000000-0000-0000-0000-000000000033'::uuid,
   (date_trunc('week', current_date) + interval '6 days')::date)
) AS v(id, host, d);

INSERT INTO match_participant (match_id, player_id, status, is_host, joined_at)
SELECT m.id, m.created_by, 'joined', true, now()
FROM match m WHERE m.notes = '[MOMENTUM] partie compatible pour le rythme de jeu';

-- ------------------------------------- 4. tournament_registration_open --
-- Left in draft on purpose. Publishing it is what fires the fan-out, so do
-- that only once the tester has the app open (see the guide's annex).
UPDATE player SET is_certified_organizer = true
 WHERE id = 'a1000000-0000-0000-0000-000000000043';

INSERT INTO tournaments (
  id, name, organizer_id, sport_id, status, visibility,
  latitude, longitude, max_participants,
  registration_opens_at, registration_closes_at, start_date, end_date,
  entry_fee_cents, description
) VALUES (
  'cccc0000-0000-0000-0000-00000000c001',
  '[MOMENTUM] Tournoi test notification',
  'a1000000-0000-0000-0000-000000000043',
  '36c45c46-1daf-48f2-b13a-cf7b2c961534',
  'draft', 'public',
  45.4751, -73.6603, 16,
  now() + interval '1 hour', now() + interval '20 days',
  now() + interval '25 days', now() + interval '26 days',
  0, 'Tournoi de test pour la notification d''ouverture des inscriptions.'
);

RESET session_replication_role;

-- ------------------------------------------------------------ verification --
SELECT notes AS fixture, match_date::text AS date, start_time::text AS heure,
       (SELECT count(*) FROM match_participant mp WHERE mp.match_id = m.id) AS participants
FROM match m WHERE notes LIKE '[MOMENTUM]%'
ORDER BY match_date, start_time;
