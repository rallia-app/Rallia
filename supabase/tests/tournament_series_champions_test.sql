-- ============================================
-- tournament_series_champions — the series recap feed (DB-level)
-- ============================================
-- Covers 20260820150000.
--
--   * the completed draw's winner comes back, named and avatar'd
--   * an uncertified organizer's draw is not part of the recap
--   * an unfinished draw is not part of the recap, even with a decided final
--   * a private draw is not part of the recap
--   * LIKE wildcards in the prefix are inert
--   * a too-short prefix returns nothing rather than the catalogue
--   * the authenticated role may execute it
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_series_champions_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.mk_tournament(
    p_name text, p_org uuid, p_sport uuid,
    p_status tournament_status, p_visibility tournament_visibility
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO tournaments (name, sport_id, organizer_id, max_participants,
                             start_date, end_date, status, visibility, completed_at)
    VALUES (p_name, p_sport, p_org, 8,
            now() - interval '20 days', now() - interval '5 days',
            p_status, p_visibility,
            CASE WHEN p_status = 'completed' THEN now() - interval '5 days' END)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- A two-entry draw whose final is decided: reg for both players, one 'main'
-- final (no next_match_id) won by the first.
CREATE OR REPLACE FUNCTION pg_temp.mk_decided_final(p_t uuid, p_winner uuid, p_loser uuid)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_r1 uuid; v_r2 uuid;
BEGIN
    INSERT INTO tournament_registrations (tournament_id, user_id, status)
    VALUES (p_t, p_winner, 'registered') RETURNING id INTO v_r1;
    INSERT INTO tournament_registrations (tournament_id, user_id, status)
    VALUES (p_t, p_loser, 'registered') RETURNING id INTO v_r2;
    INSERT INTO tournament_matches (tournament_id, bracket_side, round_number, match_position,
                                    player1_registration_id, player2_registration_id,
                                    winner_registration_id, status)
    VALUES (p_t, 'main', 1, 1, v_r1, v_r2, v_r1, 'completed');
    RETURN v_r1;
END $$;

DO $$
DECLARE
    v_sport uuid; v_p uuid[];
    v_org uuid; v_org2 uuid;
    v_t uuid;
    v_n int; v_name text; v_expected text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT ps.player_id FROM player_sport ps
          JOIN profile pr ON pr.id = ps.player_id
         WHERE ps.sport_id = v_sport AND ps.is_active = true
           AND NOT public.is_admin(ps.player_id)
           AND pr.first_name IS NOT NULL
         ORDER BY ps.player_id LIMIT 4) s;
    ASSERT array_length(v_p, 1) = 4, 'need 4 active non-admin tennis players';
    v_org  := v_p[1];
    v_org2 := v_p[2];

    UPDATE player SET is_certified_organizer = true  WHERE id = v_org;
    UPDATE player SET is_certified_organizer = false WHERE id = v_org2;

    -- 1. The happy path: completed + public + certified => the champion.
    v_t := pg_temp.mk_tournament('Recap Série T Montréal · Débutant', v_org, v_sport,
                                 'completed', 'public');
    PERFORM pg_temp.mk_decided_final(v_t, v_p[3], v_p[4]);

    SELECT count(*), min(c.champion_name) INTO v_n, v_name
      FROM tournament_series_champions('Recap Série T') c;
    ASSERT v_n = 1, format('expected 1 champion, got %s', v_n);

    SELECT trim(pr.first_name || ' ' || coalesce(pr.last_name, '')) INTO v_expected
      FROM profile pr WHERE pr.id = v_p[3];
    ASSERT v_name = v_expected,
        format('champion name %L, expected %L', v_name, v_expected);
    ASSERT (SELECT c.champion_user_id = v_p[3]
              FROM tournament_series_champions('Recap Série T') c),
        'champion_user_id is not the final winner';

    -- 2. Uncertified organizer: same prefix, never listed.
    v_t := pg_temp.mk_tournament('Recap Série T Laval · Débutant', v_org2, v_sport,
                                 'completed', 'public');
    PERFORM pg_temp.mk_decided_final(v_t, v_p[4], v_p[3]);

    -- 3. Not completed: a decided final alone is not enough.
    v_t := pg_temp.mk_tournament('Recap Série T Longueuil · Débutant', v_org, v_sport,
                                 'in_progress', 'public');
    PERFORM pg_temp.mk_decided_final(v_t, v_p[4], v_p[3]);

    -- 4. Private: never listed.
    v_t := pg_temp.mk_tournament('Recap Série T Brossard · Débutant', v_org, v_sport,
                                 'completed', 'private');
    PERFORM pg_temp.mk_decided_final(v_t, v_p[4], v_p[3]);

    SELECT count(*) INTO v_n FROM tournament_series_champions('Recap Série T');
    ASSERT v_n = 1, format('gates leaked: expected 1 row, got %s', v_n);

    -- 5. Wildcards are inert, not patterns.
    SELECT count(*) INTO v_n FROM tournament_series_champions('Recap Séri_ T');
    ASSERT v_n = 0, 'underscore matched as a wildcard';
    SELECT count(*) INTO v_n FROM tournament_series_champions('Recap%');
    ASSERT v_n = 0, 'percent matched as a wildcard';

    -- 6. Too-short prefix: nothing, not everything.
    SELECT count(*) INTO v_n FROM tournament_series_champions('Re');
    ASSERT v_n = 0, 'short prefix should return no rows';

    RAISE NOTICE 'tournament_series_champions: gates + naming OK';
END $$;

-- The popup calls this as a signed-in player: the grant must hold for the
-- authenticated role (SECURITY DEFINER does the reads).
SET LOCAL ROLE authenticated;
SELECT count(*) FROM tournament_series_champions('Recap Série T');
RESET ROLE;

ROLLBACK;
