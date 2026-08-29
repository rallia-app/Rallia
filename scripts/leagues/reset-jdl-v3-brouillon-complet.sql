-- ============================================================================
-- [JDL v3] narrow reset — 'Feuille brouillon' and 'Complet' only
-- ============================================================================
-- Both fixtures were consumed by Jean's 24-26 August pass, exactly as the
-- guide asked him to:
--
--   Feuille brouillon  seeded as Ronde 1 sheet-DRAFT / Ronde 2 sheet-PUBLISHED.
--                      Found inverted: he published Ronde 1 and regenerated
--                      Ronde 2 back to draft, which was the whole script.
--   Complet            seeded at capacity 5, 4 approved (1 suspended), 2 plain
--                      requests + 1 waitlisted. Found at capacity 6 with one
--                      request approved and one member inactive: he approved
--                      through it.
--
-- The full seed (seed-jdl-v3-retest.sql) cleans every '[JDL v3]%' league, which
-- would also destroy the four fixtures still in their seeded state and anything
-- Jean is part-way through. This resets ONLY these two, using the same bodies
-- and the same fixture roster offsets (50 and 56/62) so the player names in the
-- guide still match.
--
-- Run through the Supabase MCP execute_sql as a single call, or:
--   psql "$STAGING_DB_URL" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/leagues/reset-jdl-v3-brouillon-complet.sql
--
-- The single transaction is what keeps the pg_temp helpers alive, and
-- session_replication_role = replica keeps the notification rows without
-- sending a real push wave to the fixture players.
-- ============================================================================

SET LOCAL session_replication_role = replica;

-- ---------------------------------------------------------------------------
-- Cleanup, scoped to the two names
-- ---------------------------------------------------------------------------
DELETE FROM notification
 WHERE target_id IN (SELECT id FROM leagues
                      WHERE name IN ('[JDL v3] Feuille brouillon', '[JDL v3] Complet'))
    OR target_id IN (SELECT se.id FROM seasons se JOIN leagues l ON l.id = se.league_id
                      WHERE l.name IN ('[JDL v3] Feuille brouillon', '[JDL v3] Complet'))
    OR target_id IN (SELECT s.id FROM sessions s
                       JOIN seasons se ON se.id = s.season_id
                       JOIN leagues l ON l.id = se.league_id
                      WHERE l.name IN ('[JDL v3] Feuille brouillon', '[JDL v3] Complet'));

DELETE FROM leagues WHERE name IN ('[JDL v3] Feuille brouillon', '[JDL v3] Complet');

-- ---------------------------------------------------------------------------
-- Helpers (identical to the full seed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

CREATE OR REPLACE FUNCTION pg_temp.jdl() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM auth.users WHERE email = 'jdl.sonkin@gmail.com';
$$;

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
    v_i       integer;
BEGIN
    IF v_jdl IS NULL THEN
        RAISE EXCEPTION 'jdl.sonkin@gmail.com not found on this database';
    END IF;

    -- =====================================================================
    -- [JDL v3] Feuille brouillon — manual pairing, draft, then publish
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
    -- [JDL v3] Complet — every seat taken, requests waiting
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

    RAISE NOTICE '[JDL v3] reset: Feuille brouillon + Complet';
END $$;

-- ---------------------------------------------------------------------------
-- Proof, in the same transaction: an empty result would not be proof, so the
-- shape is asserted and the run RAISEs if either fixture came back wrong.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_r1_draft   boolean;
    v_r2_pub     boolean;
    v_active     integer;
    v_suspended  integer;
    v_pending    integer;
    v_cap        integer;
BEGIN
    SELECT s.sheet_published_at IS NULL INTO v_r1_draft
      FROM sessions s JOIN seasons se ON se.id = s.season_id
      JOIN leagues l ON l.id = se.league_id
     WHERE l.name = '[JDL v3] Feuille brouillon' AND s.name = 'Ronde 1';
    IF v_r1_draft IS NULL THEN RAISE EXCEPTION 'Ronde 1 missing'; END IF;
    IF NOT v_r1_draft THEN RAISE EXCEPTION 'Ronde 1 should be a DRAFT sheet'; END IF;

    SELECT s.sheet_published_at IS NOT NULL INTO v_r2_pub
      FROM sessions s JOIN seasons se ON se.id = s.season_id
      JOIN leagues l ON l.id = se.league_id
     WHERE l.name = '[JDL v3] Feuille brouillon' AND s.name = 'Ronde 2';
    IF v_r2_pub IS NULL THEN RAISE EXCEPTION 'Ronde 2 missing'; END IF;
    IF NOT v_r2_pub THEN RAISE EXCEPTION 'Ronde 2 should be PUBLISHED'; END IF;

    SELECT l.member_capacity,
           count(*) FILTER (WHERE lm.status = 'active'),
           count(*) FILTER (WHERE lm.status = 'suspended'),
           count(*) FILTER (WHERE lm.status = 'pending')
      INTO v_cap, v_active, v_suspended, v_pending
      FROM leagues l JOIN league_members lm ON lm.league_id = l.id
     WHERE l.name = '[JDL v3] Complet'
     GROUP BY l.member_capacity;
    IF v_cap IS NULL THEN RAISE EXCEPTION 'Complet missing'; END IF;
    IF v_cap <> 5 THEN RAISE EXCEPTION 'Complet capacity is %, expected 5', v_cap; END IF;
    -- Jean (organizer) + 3 approved, the 4th approved being the suspended one.
    IF v_active <> 4 THEN RAISE EXCEPTION 'Complet active is %, expected 4', v_active; END IF;
    IF v_suspended <> 1 THEN RAISE EXCEPTION 'Complet suspended is %, expected 1', v_suspended; END IF;
    IF v_pending <> 3 THEN RAISE EXCEPTION 'Complet pending is %, expected 3', v_pending; END IF;

    RAISE NOTICE 'reset verified: R1 draft, R2 published, Complet 5 seats / 4 active / 1 suspended / 3 waiting';
END $$;
