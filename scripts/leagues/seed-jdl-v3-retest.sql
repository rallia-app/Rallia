-- ============================================================================
-- [JDL v3] staging fixtures — retest of everything fixed since Jean's
-- test-protocol review (doc du 13 août) and the UI audit that followed
-- ============================================================================
-- Six leagues under the '[JDL v3]' prefix, one per thing to re-verify:
--
--   Formule          pointPerSetWon 3 with a played session: the scoring
--                    formula picker, the standings it produces, and the
--                    forward-looking season boundary (edit the league, the
--                    running season keeps its formula).
--   Période flexible sessionScheduling flex with one open play window: the
--                    window on the session card, the mode on the Details tab,
--                    and the window picker when the organizer creates the next
--                    one.
--   Feuille brouillon  two sessions, one sheet in DRAFT generated in manual
--                    pairing mode over TWO rounds and an odd roster (the only
--                    shape where the round-blind swap bug could show), and one
--                    already published: draft banner, swap, regenerate,
--                    publish. Confirmations are stamped a minute apart so the
--                    manual order is predictable.
--   Complet          approval league, every seat taken (4 active + 1 suspended
--                    = 5/5) with 2 plain requests and 1 waitlisted: the
--                    full-league notice before the tap, the queue ordinal on
--                    the organizer's request row, the suspended-until row,
--                    capacity on the Details tab, and the approve/refuse
--                    retest.
--   Où je joue       organized by a fixture player, Jean is a member with a
--                    draft sheet he must NOT get organizer copy for (staff is
--                    not identity), a free open season, and a share button
--                    that now mints a PLAYER link.
--   File d'attente   organized by a fixture player, full with the waitlist on
--                    and Jean queued first: "1re en file pour une place".
--   Séance privée    private league neither of Jean's accounts belongs to, so
--                    a session link bounces with the members-only message.
--                    Only reachable from a NON-staff account: RLS hides the
--                    session, and staff sees everything.
--
-- Idempotent: cleans '[JDL v3]%' (and their notifications) first.
-- Run via psql in ONE transaction:  psql "$STAGING_DB_URL" -1 -v ON_ERROR_STOP=1 \
--   -f scripts/leagues/seed-jdl-v3-retest.sql
-- or through the Supabase MCP execute_sql as a single call (implicit txn, which
-- is what keeps the pg_temp helpers alive).
-- session_replication_role = replica suppresses the push dispatch: notification
-- ROWS still land, no real push wave leaves for the fixture players. It is set
-- AFTER the cleanup on purpose; see the note there.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------
DELETE FROM notification
 WHERE target_id IN (SELECT id FROM leagues WHERE name LIKE '[JDL v3]%')
    OR target_id IN (SELECT se.id FROM seasons se
                       JOIN leagues l ON l.id = se.league_id WHERE l.name LIKE '[JDL v3]%')
    OR target_id IN (SELECT s.id FROM sessions s
                       JOIN seasons se ON se.id = s.season_id
                       JOIN leagues l ON l.id = se.league_id WHERE l.name LIKE '[JDL v3]%');
DELETE FROM leagues WHERE name LIKE '[JDL v3]%';

-- IMPORTANT: session_replication_role = replica also disables the SYSTEM
-- triggers that implement foreign keys, so ON DELETE CASCADE silently does
-- nothing while it is set. The DELETEs below therefore run in normal mode and
-- replica is switched on only around the CREATION, which is the only part that
-- would otherwise dispatch a push. Setting it earlier orphans every season,
-- session, match, member and conversation under the rows being removed.
SET LOCAL session_replication_role = replica;

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
-- different roster. Offsets 40+ stay clear of the [JDL v2] rosters (0-23, 30-40).
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

-- league_create is admin-gated since 20260812150000. Fixture organizers get a
-- temporary staff row around each create; the revoke is mandatory.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- Confirmations land inside one transaction, so now() is identical for all of
-- them and manual pairing (ordered by responded_at) would fall back to uuid
-- order. Stamping them a minute apart makes the confirmation order the one the
-- guide can name.
CREATE OR REPLACE FUNCTION pg_temp.stamp_presence(p_session uuid, p_users uuid[]) RETURNS void
LANGUAGE sql AS $$
  UPDATE session_presence sp
     SET responded_at = now() + (u.ord * interval '1 minute')
    FROM (SELECT unnest(p_users) AS user_id, generate_subscripts(p_users, 1) AS ord) u
   WHERE sp.session_id = p_session AND sp.user_id = u.user_id;
$$;

DO $$
DECLARE
    v_jdl     uuid := pg_temp.jdl();
    v_tennis  uuid := (SELECT id FROM sport WHERE name = 'tennis');
    v_fakes   uuid[];
    v_league  leagues;
    v_season  seasons;
    v_sess    sessions;
    v_member  league_members;
    v_m       record;
    v_scores  text[] := ARRAY['6-4 6-2', '7-6(4) 6-7(5) 7-6(3)', '6-0 6-0'];
    v_i       integer;
BEGIN
    IF v_jdl IS NULL THEN
        RAISE EXCEPTION 'jdl.sonkin@gmail.com not found on this database';
    END IF;

    -- =====================================================================
    -- 1. [JDL v3] Formule — the scoring formula, visible in the standings
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name           => '[JDL v3] Formule',
        p_sport_id       => v_tennis,
        p_description    => 'Victoire 10, défaite 1, plus 3 points par set gagné. Le classement le montre: le joueur battu 7-6 6-7 7-6 repart avec 4 points, celui qui perd 6-0 6-0 avec 1.',
        p_visibility     => 'public',
        p_join_mode      => 'open',
        p_rules_override => '{"pointPerSetWon": 3}'::jsonb);

    v_fakes := pg_temp.fakes(40, 5);
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 14, current_date + 45);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(v_season.id, 'Soirée 1', now() + interval '2 hours');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);
    v_sess := public.session_publish_sheet(v_sess.id, v_sess.version);

    v_i := 0;
    FOR v_m IN SELECT * FROM session_matches
                WHERE session_id = v_sess.id AND is_drill = false ORDER BY id LOOP
        v_i := v_i + 1;
        PERFORM public.session_record_score(
            v_m.id, 'a', v_scores[1 + ((v_i - 1) % 3)], 'completed', v_m.version);
    END LOOP;

    -- =====================================================================
    -- 2. [JDL v3] Période flexible — a window to play in, not an evening
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name           => '[JDL v3] Période flexible',
        p_sport_id       => v_tennis,
        p_description    => 'Les séances sont des périodes, pas des soirs. La première est ouverte: les membres organisent leur partie dedans. Crée la suivante pour voir le sélecteur de période.',
        p_visibility     => 'public',
        p_join_mode      => 'open',
        p_rules_override => '{"sessionScheduling": "flex", "gamesPerPlayer": 1}'::jsonb);

    v_fakes := pg_temp.fakes(45, 5);
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    -- Starts on the 1st of the month on purpose: the season header used to
    -- render the day before (UTC midnight read as local).
    PERFORM pg_temp.as_user(v_jdl);
    v_season := public.season_create(
        v_league.id, 'Automne 2026',
        date_trunc('month', current_date)::date, current_date + 60);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(
        p_season_id           => v_season.id,
        p_name                => 'Semaine 1',
        p_scheduled_at        => now() + interval '1 day',
        p_play_window_ends_at => now() + interval '8 days');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);
    v_sess := public.session_publish_sheet(v_sess.id, v_sess.version);

    -- =====================================================================
    -- 3. [JDL v3] Feuille brouillon — manual pairing, draft, then publish
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name        => '[JDL v3] Feuille brouillon',
        p_sport_id    => v_tennis,
        p_description => 'Ronde 1 est un brouillon en pairage manuel, deux rondes avec un bye: personne d''autre que toi ne la voit. Ronde 2 est déjà publiée. Ajuste, publie, puis régénère la publiée pour la voir retourner en brouillon.',
        p_visibility  => 'public',
        p_join_mode   => 'open');

    v_fakes  := pg_temp.fakes(50, 5);
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_season := public.season_create(
        v_league.id, 'Automne 2026',
        date_trunc('month', current_date)::date, current_date + 60);
    v_season := public.season_open(v_season.id, v_season.version);

    -- Ronde 1: manual pairing, sheet left in draft. Two rounds and an ODD
    -- roster on purpose. session_swap_player was round-blind (it picked an
    -- arbitrary match for the arriving player and could seat someone against
    -- himself), and a one-round sheet is the only shape where that cannot
    -- happen, which is exactly why the original test missed it. Five
    -- confirmed over two rounds gives a bye per round and a real swap target.
    v_sess := public.session_create(
        p_season_id    => v_season.id,
        p_name         => 'Ronde 1',
        p_scheduled_at => now() + interval '2 days',
        p_rounds       => 2::smallint,
        p_pairing_mode => 'manual');
    v_sess := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;
    PERFORM pg_temp.stamp_presence(v_sess.id, ARRAY[v_jdl] || v_fakes[1:4]);

    PERFORM pg_temp.as_user(v_jdl);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);

    -- Ronde 2: ordinary pairing, sheet published.
    v_sess := public.session_create(
        p_season_id    => v_season.id,
        p_name         => 'Ronde 2',
        p_scheduled_at => now() + interval '9 days');
    v_sess := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);
    v_sess := public.session_publish_sheet(v_sess.id, v_sess.version);

    -- =====================================================================
    -- 4. [JDL v3] Complet — every seat taken, two requests waiting
    -- =====================================================================
    PERFORM pg_temp.as_user(v_jdl);
    v_league := public.league_create(
        p_name        => '[JDL v3] Complet',
        p_sport_id    => v_tennis,
        p_description => 'Cinq places, cinq occupées (dont une suspendue, qui garde sa place). Trois demandes attendent, dont une en file: la liste te dit que la ligue est pleine avant que tu approuves.',
        p_visibility  => 'public',
        p_join_mode   => 'approval');

    v_fakes := pg_temp.fakes(56, 6);
    FOR v_i IN 1..6 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    -- Approve four, suspend one of them: 4 active + 1 suspended = 5 seats.
    PERFORM pg_temp.as_user(v_jdl);
    FOR v_i IN 1..4 LOOP
        SELECT * INTO v_member FROM league_members
         WHERE league_id = v_league.id AND user_id = v_fakes[v_i];
        v_member := public.league_approve_member(v_member.id, v_member.version);
    END LOOP;

    SELECT * INTO v_member FROM league_members
     WHERE league_id = v_league.id AND user_id = v_fakes[4];
    PERFORM public.league_suspend_member(
        v_member.id, v_member.version,
        'Deux absences non annoncées', (current_date + 10)::timestamptz);

    UPDATE leagues
       SET member_capacity = 5, waitlist_enabled = true, version = version + 1
     WHERE id = v_league.id;

    -- One more request, this one arriving AFTER the seats filled, so it lands
    -- in the waitlist: that is the organizer-side row carrying the ordinal
    -- ("1re en file pour une place"), which the queue chip alone never shows.
    PERFORM pg_temp.as_user((pg_temp.fakes(62, 1))[1]);
    PERFORM public.league_join(v_league.id);

    PERFORM pg_temp.as_user(v_jdl);
    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 7, current_date + 50);
    v_season := public.season_open(v_season.id, v_season.version);

    -- =====================================================================
    -- 5. [JDL v3] Où je joue — Jean is a member, and staff is not identity
    -- =====================================================================
    v_fakes := pg_temp.fakes(63, 5);
    PERFORM pg_temp.as_user(v_fakes[1]);
    PERFORM pg_temp.staff_on(v_fakes[1]);
    v_league := public.league_create(
        p_name        => '[JDL v3] Où je joue',
        p_sport_id    => v_tennis,
        p_description => 'Tu es joueur ici, pas organisateur. La feuille de la séance est encore un brouillon: tu vois les pairages parce que tu es admin, mais rien ne doit te parler comme si c''était ta ligue.',
        p_visibility  => 'public',
        p_join_mode   => 'open');
    PERFORM pg_temp.staff_off(v_fakes[1]);

    PERFORM pg_temp.as_user(v_jdl);
    PERFORM public.league_join(v_league.id);
    FOR v_i IN 2..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_fakes[1]);
    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 7, current_date + 50);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(v_season.id, 'Soirée test', now() + interval '3 days');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 2..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;
    PERFORM pg_temp.as_user(v_jdl);
    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');

    -- Left in draft on purpose: the organizer-voice banner must not reach a
    -- staff viewer who only plays here.
    PERFORM pg_temp.as_user(v_fakes[1]);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);

    -- =====================================================================
    -- 6. [JDL v3] File d'attente — Jean queued first
    -- =====================================================================
    v_fakes := pg_temp.fakes(68, 3);
    PERFORM pg_temp.as_user(v_fakes[1]);
    PERFORM pg_temp.staff_on(v_fakes[1]);
    v_league := public.league_create(
        p_name        => '[JDL v3] File d''attente',
        p_sport_id    => v_tennis,
        p_description => 'Trois places, trois prises. Ta demande t''a mis en file: la pastille doit dire 1re en file pour une place.',
        p_visibility  => 'public',
        p_join_mode   => 'open');
    PERFORM pg_temp.staff_off(v_fakes[1]);

    UPDATE leagues
       SET member_capacity = 3, waitlist_enabled = true, version = version + 1
     WHERE id = v_league.id;

    FOR v_i IN 2..3 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_jdl);
    PERFORM public.league_join(v_league.id);

    PERFORM pg_temp.as_user(v_fakes[1]);
    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 7, current_date + 50);
    v_season := public.season_open(v_season.id, v_season.version);

    -- =====================================================================
    -- 7. [JDL v3] Séance privée — the members-only bounce
    -- =====================================================================
    -- The bounce fires only when RLS HIDES the session, which needs a
    -- non-public league and a reader who is neither organizer, member, nor
    -- staff. Both of Jean's accounts were super_admin, which is why this was
    -- untestable until jdl.sonkin+10 lost the role (2026-08-24). Neither
    -- account is a member here, and the final SELECT prints the session URL
    -- to send him.
    v_fakes := pg_temp.fakes(72, 5);
    PERFORM pg_temp.as_user(v_fakes[1]);
    PERFORM pg_temp.staff_on(v_fakes[1]);
    v_league := public.league_create(
        p_name        => '[JDL v3] Séance privée',
        p_sport_id    => v_tennis,
        p_description => 'Ligue privée. Ni toi ni ton compte +10 n''en êtes membres: le lien de séance doit expliquer pourquoi il ne mène pas à la séance.',
        p_visibility  => 'private',
        p_join_mode   => 'open');
    PERFORM pg_temp.staff_off(v_fakes[1]);

    FOR v_i IN 2..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_fakes[1]);
    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 7, current_date + 50);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(v_season.id, 'Séance mystère', now() + interval '4 days');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 2..5 LOOP
        PERFORM pg_temp.as_user(v_fakes[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_fakes[1]);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);
    v_sess := public.session_publish_sheet(v_sess.id, v_sess.version);
    -- invite_only would refuse league_join (NOT_INVITED), so the league is
    -- private + open and the organizer link is minted here.
    PERFORM public.league_invite_get_or_create(v_league.id);

    RAISE NOTICE '[JDL v3] fixtures seeded: 7 leagues';
END $$;

-- ---------------------------------------------------------------------------
-- What was created (the guide quotes these numbers, so read them from here)
-- ---------------------------------------------------------------------------
SELECT l.name AS league,
       l.join_mode,
       l.member_capacity,
       (SELECT count(*) FROM league_members m WHERE m.league_id = l.id AND m.status = 'active')    AS active,
       (SELECT count(*) FROM league_members m WHERE m.league_id = l.id AND m.status = 'pending')   AS pending,
       (SELECT count(*) FROM league_members m WHERE m.league_id = l.id AND m.status = 'suspended') AS suspended,
       l.default_rules ->> 'pointPerSetWon'    AS bonus_set,
       l.default_rules ->> 'sessionScheduling' AS scheduling
  FROM leagues l
 WHERE l.name LIKE '[JDL v3]%'
 ORDER BY l.name;

-- The session URL to send for the members-only bounce. One shot per account:
-- redeeming the link makes the reader a member and the message stops firing.
SELECT 'https://rallia.app/invite/' || public.get_or_create_player_referral_code(l.organizer_id)
       || '?type=league&id=' || l.id || '&share=' || il.token || '&session=' || s.id AS bounce_url
  FROM leagues l
  JOIN league_invite_links il ON il.league_id = l.id
  JOIN seasons se ON se.league_id = l.id
  JOIN sessions s ON s.season_id = se.id
 WHERE l.name = '[JDL v3] Séance privée';
