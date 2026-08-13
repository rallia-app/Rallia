-- ============================================================================
-- Remove everything seed-match-organizer-local.sql creates
-- ============================================================================
-- Safe to run on a database that was never seeded. The seed runs this first, so
-- it is also what makes the seed re-runnable.
--
-- NOTE: the seed rewrites the availability grids of the three opponent accounts
-- (Helene Vallee, Andre Thibault, Suzanne Raymond) and this cannot put their
-- original hours back. Everything else is created fresh and removed cleanly.
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/organizer/cleanup-match-organizer-local.sql
-- ============================================================================

DO $cleanup$
DECLARE
    v_tourns  uuid[];
    v_leagues uuid[];
    v_convs   uuid[];
    v_matches uuid[];
    v_msgs    uuid[];
BEGIN
    SELECT COALESCE(array_agg(id), '{}') INTO v_tourns  FROM tournaments WHERE name LIKE '[MO]%';
    SELECT COALESCE(array_agg(id), '{}') INTO v_leagues FROM leagues     WHERE name LIKE '[MO]%';

    -- Every chat the fixtures own: tournament round chats, league pairing chats,
    -- and the seeded direct chat (created by Helene with the tester in it).
    SELECT COALESCE(array_agg(DISTINCT c.id), '{}') INTO v_convs
      FROM conversation c
     WHERE c.tournament_match_id IN (
             SELECT tm.id FROM tournament_matches tm WHERE tm.tournament_id = ANY(v_tourns))
        OR c.session_match_id IN (
             SELECT sm.id FROM session_matches sm
              JOIN sessions s   ON s.id = sm.session_id
              JOIN seasons se   ON se.id = s.season_id
             WHERE se.league_id = ANY(v_leagues))
        OR (c.conversation_type = 'direct'
            AND c.created_by = 'a1000000-0000-0000-0000-000000000098'
            AND EXISTS (SELECT 1 FROM conversation_participant cp
                         JOIN auth.users u ON u.id = cp.player_id
                        WHERE cp.conversation_id = c.id
                          AND u.email = 'lefrancmathis2@gmail.com'));

    -- Games created from those cards.
    SELECT COALESCE(array_agg(DISTINCT mid), '{}') INTO v_matches FROM (
        SELECT c.match_id AS mid FROM conversation c
         WHERE c.id = ANY(v_convs) AND c.match_id IS NOT NULL
        UNION
        SELECT (m.metadata->>'created_match_id')::uuid FROM message m
         WHERE m.conversation_id = ANY(v_convs)
           AND COALESCE(m.metadata->>'created_match_id', '') <> ''
    ) s WHERE mid IS NOT NULL;

    SELECT COALESCE(array_agg(id), '{}') INTO v_msgs
      FROM message WHERE conversation_id = ANY(v_convs);

    DELETE FROM match_time_vote WHERE message_id = ANY(v_msgs);
    DELETE FROM message_reaction WHERE message_id = ANY(v_msgs);
    DELETE FROM message WHERE id = ANY(v_msgs);

    -- Break the links before the rows go, so nothing blocks on a FK.
    UPDATE conversation SET match_id = NULL WHERE id = ANY(v_convs);
    UPDATE tournament_matches SET match_id = NULL
     WHERE tournament_id = ANY(v_tourns) OR match_id = ANY(v_matches);
    UPDATE session_matches SET match_id = NULL WHERE match_id = ANY(v_matches);

    DELETE FROM conversation_participant WHERE conversation_id = ANY(v_convs);
    DELETE FROM conversation WHERE id = ANY(v_convs);

    DELETE FROM match_result WHERE match_id = ANY(v_matches);
    DELETE FROM match_participant WHERE match_id = ANY(v_matches);
    DELETE FROM match WHERE id = ANY(v_matches);

    DELETE FROM notification
     WHERE target_id = ANY(v_tourns)
        OR (payload->>'tournamentId')::uuid = ANY(v_tourns);

    DELETE FROM tournament_matches       WHERE tournament_id = ANY(v_tourns);
    DELETE FROM tournament_round_deadlines WHERE tournament_id = ANY(v_tourns);
    DELETE FROM tournament_registrations WHERE tournament_id = ANY(v_tourns);
    DELETE FROM leagues_tournaments_audit
     WHERE (payload_after->>'tournament_id')::uuid = ANY(v_tourns)
        OR (payload_before->>'tournament_id')::uuid = ANY(v_tourns);
    DELETE FROM tournaments WHERE id = ANY(v_tourns);

    DELETE FROM session_matches
     WHERE session_id IN (SELECT s.id FROM sessions s JOIN seasons se ON se.id = s.season_id
                           WHERE se.league_id = ANY(v_leagues));
    DELETE FROM session_match_scores
     WHERE session_match_id IN (
             SELECT sm.id FROM session_matches sm
              JOIN sessions s ON s.id = sm.session_id
              JOIN seasons se ON se.id = s.season_id
             WHERE se.league_id = ANY(v_leagues));
    DELETE FROM session_presence
     WHERE session_id IN (SELECT s.id FROM sessions s JOIN seasons se ON se.id = s.season_id
                           WHERE se.league_id = ANY(v_leagues));
    DELETE FROM session_attendance
     WHERE session_id IN (SELECT s.id FROM sessions s JOIN seasons se ON se.id = s.season_id
                           WHERE se.league_id = ANY(v_leagues));
    DELETE FROM session_courts
     WHERE session_id IN (SELECT s.id FROM sessions s JOIN seasons se ON se.id = s.season_id
                           WHERE se.league_id = ANY(v_leagues));
    DELETE FROM sessions
     WHERE season_id IN (SELECT id FROM seasons WHERE league_id = ANY(v_leagues));
    DELETE FROM season_rankings WHERE season_id IN (SELECT id FROM seasons WHERE league_id = ANY(v_leagues));
    DELETE FROM season_members  WHERE season_id IN (SELECT id FROM seasons WHERE league_id = ANY(v_leagues));
    DELETE FROM seasons WHERE league_id = ANY(v_leagues);
    DELETE FROM league_members WHERE league_id = ANY(v_leagues);
    DELETE FROM leagues WHERE id = ANY(v_leagues);

    DELETE FROM facility_availability_snapshot WHERE source = 'mo-seed';

    -- The seed grants the organizer staff rights temporarily; make sure a failed
    -- run cannot leave them behind.
    DELETE FROM admin WHERE id = 'a1000000-0000-0000-0000-000000000093';

    RAISE NOTICE 'cleanup: % tournaments, % leagues, % chats, % games',
        COALESCE(array_length(v_tourns,1),0), COALESCE(array_length(v_leagues,1),0),
        COALESCE(array_length(v_convs,1),0),  COALESCE(array_length(v_matches,1),0);
END
$cleanup$;

DROP FUNCTION IF EXISTS public.mo_opponent_agrees(uuid);
