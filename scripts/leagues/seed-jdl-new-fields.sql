-- ============================================================================
-- [JDL v2] staging fixtures — the 2026-08 league review batch, testable by Jean
-- ============================================================================
-- Six leagues under the '[JDL v2]' prefix covering everything the batch added:
--
--   Demandes à trier   approval league with 3 pending requests: the new refuse
--                      button, and the rejection notification to the requester.
--   Barème maison      custom points (3/1/2) and no season yet: the "comment ça
--                      marche" card, the edit sheet opening on the custom
--                      values, the 4-season presets, games-per-player at season
--                      creation, then recurrence on the create-session sheet.
--   Jeux comptés       pointPerGameWon 1 with a played session: standings where
--                      the games actually count (a 7-6 6-7 7-6 loser nearly
--                      ties a 6-4 6-2 winner).
--   Soir de feuille    open season at 2 games per player, published session
--                      with a generated 2-round sheet, unscored: the swap
--                      button and the multi-round sheet.
--   Historique         two closed seasons plus one open, all with standings:
--                      the season chips on the standings block, and the new
--                      close-season confirmation.
--   Où je joue         organized by a fixture player, Jean is a member of the
--                      free open season: the player-side auto-enrolled note.
--
-- Idempotent: cleans '[JDL v2]%' (and their notifications) first.
-- Run via psql in ONE transaction:  psql "$STAGING_DB_URL" -1 -v ON_ERROR_STOP=1 \
--   -f scripts/leagues/seed-jdl-new-fields.sql
-- or through the Supabase MCP execute_sql as a single call (implicit txn).
-- Fires real notifications (join requests to Jean), which is intended.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------
DELETE FROM notification
 WHERE target_id IN (SELECT id FROM leagues WHERE name LIKE '[JDL v2]%')
    OR target_id IN (SELECT se.id FROM seasons se
                       JOIN leagues l ON l.id = se.league_id WHERE l.name LIKE '[JDL v2]%')
    OR target_id IN (SELECT s.id FROM sessions s
                       JOIN seasons se ON se.id = s.season_id
                       JOIN leagues l ON l.id = se.league_id WHERE l.name LIKE '[JDL v2]%');
DELETE FROM leagues WHERE name LIKE '[JDL v2]%';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

CREATE OR REPLACE FUNCTION pg_temp.jdl() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM auth.users WHERE email = 'jdl.sonkin@gmail.com';
$$;

-- Fixture tennis players, deterministic, offset so each league gets a
-- different roster.
CREATE OR REPLACE FUNCTION pg_temp.fakes(p_offset integer, n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(id) FROM (
    SELECT u.id
      FROM auth.users u
      JOIN player_sport ps ON ps.player_id = u.id
      JOIN sport s ON s.id = ps.sport_id AND s.name = 'tennis'
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.is_active
       AND NOT public.is_admin(u.id)
       AND u.id IS DISTINCT FROM pg_temp.jdl()
     ORDER BY u.email OFFSET p_offset LIMIT n) t;
$$;


-- Since 20260812150000, league_create is admin-gated server-side. Fixture
-- organizers get a temporary staff row around each create; the revoke is
-- mandatory (same pattern as the SQL test suite).
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

DO $$
DECLARE
    v_jdl    uuid := pg_temp.jdl();
    v_fakes  uuid[];
    v_league leagues;
    v_season seasons;
    v_sess   sessions;
    v_m      record;
    v_scores text[] := ARRAY['6-4 6-2', '7-6(4) 6-7(5) 7-6(3)', '6-0 6-0'];
    v_i      integer;
BEGIN
    IF v_jdl IS NULL THEN
        RAISE EXCEPTION 'jdl.sonkin@gmail.com not found on this database';
    END IF;

    -- =====================================================================
    -- 1. [JDL v2] Demandes à trier — refuse or approve, requester notified
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name        => '[JDL v2] Demandes à trier',
        p_sport_id    => (SELECT id FROM sport WHERE name = 'tennis'),
        p_description => 'Trois demandes attendent ta décision. Le X rouge refuse la demande et le joueur reçoit une notification.',
        p_visibility  => 'public',
        p_join_mode   => 'approval');

    v_fakes := pg_temp.fakes(0, 3);
    FOR v_i IN 1..3 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    -- =====================================================================
    -- 2. [JDL v2] Barème maison — custom points, no season yet
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name           => '[JDL v2] Barème maison',
        p_sport_id       => (SELECT id FROM sport WHERE name = 'tennis'),
        p_description    => 'Victoire 3, défaite 1, bye 2. La carte Comment ça marche les montre, et la feuille de modification ouvre sur ces valeurs. Pas encore de saison: en créer une passe par les 4 presets et les parties par joueur.',
        p_visibility     => 'public',
        p_join_mode      => 'open',
        p_rules_override => '{"pointWin": 3, "pointLoss": 1, "pointBye": 2,
                              "pointRetirementWinner": 3, "pointWalkoverWinner": 3}'::jsonb);

    v_fakes := pg_temp.fakes(3, 3);
    FOR v_i IN 1..3 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    -- =====================================================================
    -- 3. [JDL v2] Jeux comptés — pointPerGameWon in live standings
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name           => '[JDL v2] Jeux comptés',
        p_sport_id       => (SELECT id FROM sport WHERE name = 'tennis'),
        p_description    => 'Chaque jeu gagné vaut 1 point en plus du résultat. Regarde le classement: perdre 7-6 6-7 7-6 rapporte presque autant que gagner 6-4 6-2.',
        p_visibility     => 'public',
        p_join_mode      => 'open',
        p_rules_override => '{"pointPerGameWon": 1}'::jsonb);

    v_fakes := pg_temp.fakes(6, 5);
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 14, current_date + 45);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(v_season.id, 'Soirée 1', now() + interval '2 hours');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM pg_temp.as_user(v_jdl);
    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);

    v_i := 0;
    FOR v_m IN SELECT * FROM session_matches
                WHERE session_id = v_sess.id AND is_drill = false ORDER BY id LOOP
        v_i := v_i + 1;
        PERFORM public.session_record_score(
            v_m.id, 'a', v_scores[1 + ((v_i - 1) % 3)], 'completed', v_m.version);
    END LOOP;

    -- =====================================================================
    -- 4. [JDL v2] Soir de feuille — 2 rounds, unscored, swap-ready
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name           => '[JDL v2] Soir de feuille',
        p_sport_id       => (SELECT id FROM sport WHERE name = 'tennis'),
        p_description    => 'Feuille générée à 2 parties par joueur, rien de joué encore. Le bouton d''échange remplace un joueur sans tout régénérer; le joueur en bye peut entrer.',
        p_visibility     => 'public',
        p_join_mode      => 'open');

    v_fakes := pg_temp.fakes(11, 4);
    FOR v_i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_season := public.season_create(
        v_league.id, 'Automne 2026', current_date, current_date + 80,
        p_rules_override => '{"gamesPerPlayer": 2}'::jsonb);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(
        p_season_id    => v_season.id,
        p_name         => 'Mardi soir',
        p_scheduled_at => now() + interval '3 days',
        p_rounds       => 2::smallint);
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM pg_temp.as_user(v_jdl);
    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);

    -- =====================================================================
    -- 5. [JDL v2] Historique — season chips + close confirmation
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name        => '[JDL v2] Historique',
        p_sport_id    => (SELECT id FROM sport WHERE name = 'tennis'),
        p_description => 'Deux saisons fermées et une ouverte. Les pastilles au-dessus du classement naviguent entre les saisons. Fermer la saison ouverte demande maintenant une confirmation.',
        p_visibility  => 'public',
        p_join_mode   => 'open');

    v_fakes := pg_temp.fakes(15, 5);
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    -- Two archived seasons, inserted directly: the chips and the table read
    -- seasons + season_rankings, so a closed fixture needs nothing else.
    WITH members AS (
        SELECT unnest(ARRAY[v_jdl] || v_fakes) AS user_id
    ), s1 AS (
        INSERT INTO seasons (league_id, name, start_date, end_date, rules, status, closed_at, rules_locked_at)
        VALUES (v_league.id, 'Hiver 2026',
                date_trunc('year', current_date)::date,
                (date_trunc('year', current_date) + interval '3 months - 1 day')::date,
                v_league.default_rules, 'closed',
                date_trunc('year', current_date) + interval '3 months', now())
        RETURNING id
    )
    INSERT INTO season_rankings (season_id, user_id, points, wins, losses, sets_won, sets_lost,
                                 games_won, games_lost, matches_played, sessions_attended,
                                 sessions_eligible, rank, tiebreak_seed)
    SELECT s1.id, m.user_id,
           (ARRAY[71, 62, 53, 44, 35, 17])[rn], (ARRAY[7, 6, 5, 4, 3, 1])[rn],
           8 - (ARRAY[7, 6, 5, 4, 3, 1])[rn],
           (ARRAY[14, 12, 11, 9, 7, 3])[rn], (ARRAY[4, 6, 7, 9, 11, 14])[rn],
           (ARRAY[92, 85, 78, 70, 61, 44])[rn], (ARRAY[55, 63, 70, 77, 84, 95])[rn],
           8, 8, 8, rn,
           hashtext(s1.id::text || m.user_id::text)::bigint
      FROM s1, (SELECT user_id, row_number() OVER () AS rn FROM members) m;

    WITH members AS (
        SELECT unnest(v_fakes || ARRAY[v_jdl]) AS user_id
    ), s2 AS (
        INSERT INTO seasons (league_id, name, start_date, end_date, rules, status, closed_at, rules_locked_at)
        VALUES (v_league.id, 'Printemps 2026',
                (date_trunc('year', current_date) + interval '3 months')::date,
                (date_trunc('year', current_date) + interval '6 months - 1 day')::date,
                v_league.default_rules, 'closed',
                date_trunc('year', current_date) + interval '6 months', now())
        RETURNING id
    )
    INSERT INTO season_rankings (season_id, user_id, points, wins, losses, sets_won, sets_lost,
                                 games_won, games_lost, matches_played, sessions_attended,
                                 sessions_eligible, rank, tiebreak_seed)
    SELECT s2.id, m.user_id,
           (ARRAY[80, 71, 62, 44, 35, 26])[rn], (ARRAY[8, 7, 6, 4, 3, 2])[rn],
           8 - (ARRAY[8, 7, 6, 4, 3, 2])[rn],
           (ARRAY[16, 14, 12, 9, 7, 5])[rn], (ARRAY[2, 4, 6, 9, 11, 12])[rn],
           (ARRAY[97, 90, 82, 69, 60, 52])[rn], (ARRAY[48, 58, 66, 78, 85, 90])[rn],
           8, 8, 8, rn,
           hashtext(s2.id::text || m.user_id::text)::bigint
      FROM s2, (SELECT user_id, row_number() OVER () AS rn FROM members) m;

    -- The open season goes through the RPCs (seeds zeroed rankings), then gets
    -- believable mid-season numbers. No sessions exist, so no recalc will ever
    -- overwrite them; closing the season snapshots them as-is.
    PERFORM pg_temp.as_user(v_jdl);
    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 21, current_date + 40);
    v_season := public.season_open(v_season.id, v_season.version);

    WITH ranked AS (
        SELECT user_id, row_number() OVER (ORDER BY user_id) AS rn
          FROM season_rankings WHERE season_id = v_season.id
    )
    UPDATE season_rankings sr
       SET points = (ARRAY[40, 31, 22, 22, 13, 4])[r.rn],
           wins   = (ARRAY[4, 3, 2, 2, 1, 0])[r.rn],
           losses = 4 - (ARRAY[4, 3, 2, 2, 1, 0])[r.rn],
           sets_won = (ARRAY[8, 6, 5, 4, 2, 1])[r.rn],
           sets_lost = (ARRAY[1, 3, 5, 5, 7, 8])[r.rn],
           games_won = (ARRAY[50, 44, 38, 36, 28, 20])[r.rn],
           games_lost = (ARRAY[24, 32, 39, 40, 46, 50])[r.rn],
           matches_played = 4, sessions_attended = 4, sessions_eligible = 4,
           rank = r.rn
      FROM ranked r
     WHERE sr.season_id = v_season.id AND sr.user_id = r.user_id;

    -- =====================================================================
    -- 6. [JDL v2] Où je joue — player side, free-season auto-enrolment
    -- =====================================================================
    v_fakes := pg_temp.fakes(20, 4);
    PERFORM pg_temp.as_user(v_fakes[1]);
    PERFORM pg_temp.staff_on(v_fakes[1]);
    v_league := public.league_create(
        p_name        => '[JDL v2] Où je joue',
        p_sport_id    => (SELECT id FROM sport WHERE name = 'tennis'),
        p_description => 'Tu es joueur ici, pas organisateur. La saison gratuite est ouverte: pas de bouton pour la rejoindre, la note dit que tous les membres actifs y participent.',
        p_visibility  => 'public',
        p_join_mode   => 'open');
    PERFORM pg_temp.staff_off(v_fakes[1]);

    PERFORM pg_temp.as_user(pg_temp.jdl());
    PERFORM public.league_join(v_league.id);
    FOR v_i IN 2..4 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_fakes[1]);
    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 7, current_date + 50);
    v_season := public.season_open(v_season.id, v_season.version);

    RAISE NOTICE '[JDL v2] fixtures seeded: 6 leagues';
END $$;
