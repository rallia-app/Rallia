-- ============================================================================
-- [JDL v2] share fixtures — the recipient side of league/session share links
-- ============================================================================
-- Jean's own six [JDL v2] leagues already cover the SENDER side (he organizes
-- five of them and is a plain member of a sixth, all public, so both the
-- organizer and player share buttons appear once he has the new build). What
-- they cannot cover is RECEIVING a link, since he is already in all of them.
--
-- Two additional leagues, organized by fixture players, that Jean is NOT in:
--
--   Partage secret       private + invite_only, with an open season and a
--                        published session. The pre-minted ORGANIZER link is
--                        the skeleton key: the league page renders via the
--                        preview RPC even though RLS hides the league, and
--                        Rejoindre lands him active despite invite_only. The
--                        session variant of the link exercises the bounce:
--                        SessionDetail can't load -> LeagueDetail + token.
--   Partage sur demande  public + approval, with a pre-minted PLAYER link
--                        (minted by a fixture player). Redeeming goes through
--                        the normal rules: Jean lands as a pending request.
--
-- The final SELECT prints the ready-to-send URLs (League A link, Session A
-- link, League B player link, and a member-side session link into his own
-- Soir de feuille that lands straight on the sheet).
--
-- Idempotent: cleans only '[JDL v2] Partage%' — never touches the other
-- [JDL v2] leagues Jean may be mid-testing.
-- Run: psql "$STAGING_DB_URL" -1 -v ON_ERROR_STOP=1 -f scripts/leagues/seed-jdl-share-fixtures.sql
-- or through the Supabase MCP execute_sql as a single call (implicit txn).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Cleanup (own leagues only)
-- ---------------------------------------------------------------------------
DELETE FROM notification
 WHERE target_id IN (SELECT id FROM leagues WHERE name LIKE '[JDL v2] Partage%')
    OR target_id IN (SELECT se.id FROM seasons se
                       JOIN leagues l ON l.id = se.league_id WHERE l.name LIKE '[JDL v2] Partage%')
    OR target_id IN (SELECT s.id FROM sessions s
                       JOIN seasons se ON se.id = s.season_id
                       JOIN leagues l ON l.id = se.league_id WHERE l.name LIKE '[JDL v2] Partage%');
DELETE FROM leagues WHERE name LIKE '[JDL v2] Partage%';

-- ---------------------------------------------------------------------------
-- Helpers (same shape as seed-jdl-new-fields.sql)
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
    v_jdl     uuid := pg_temp.jdl();
    v_org_a   uuid;
    v_org_b   uuid;
    v_sharer  uuid;
    v_league  leagues;
    v_season  seasons;
    v_sess    sessions;
BEGIN
    IF v_jdl IS NULL THEN
        RAISE EXCEPTION 'jdl.sonkin@gmail.com not found on this database';
    END IF;

    v_org_a  := (pg_temp.fakes(30, 1))[1];
    v_org_b  := (pg_temp.fakes(36, 1))[1];
    v_sharer := (pg_temp.fakes(37, 1))[1];

    -- The share URLs credit the sharer's referral code; fixture players don't
    -- all have one.
    UPDATE profile SET referral_code = upper(substr(md5(id::text || 'share'), 1, 8))
     WHERE id IN (v_org_a, v_sharer, v_jdl) AND referral_code IS NULL;

    -- =====================================================================
    -- A. [JDL v2] Partage secret — private + invite_only, organizer link
    -- =====================================================================
    PERFORM pg_temp.as_user(v_org_a);
    PERFORM pg_temp.staff_on(v_org_a);
    v_league := public.league_create(
        p_name        => '[JDL v2] Partage secret',
        p_sport_id    => (SELECT id FROM sport WHERE name = 'tennis'),
        p_description => 'Tu vois cette ligue uniquement grâce au lien : elle est privée et sur invitation. Le lien de l''organisateur te fait entrer directement — appuie sur Rejoindre. La variante « séance » du lien devait d''abord rebondir ici puisque la séance t''était cachée.',
        p_visibility  => 'private',
        p_join_mode   => 'invite_only');
    PERFORM pg_temp.staff_off(v_org_a);

    v_season := public.season_create(v_league.id, 'Été 2026', current_date - 7, current_date + 50);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(
        p_season_id    => v_season.id,
        p_name         => 'Séance mystère',
        p_scheduled_at => now() + interval '4 days');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM public.league_invite_get_or_create(v_league.id);   -- organizer link

    -- =====================================================================
    -- B. [JDL v2] Partage sur demande — public + approval, player link
    -- =====================================================================
    PERFORM pg_temp.as_user(v_org_b);
    PERFORM pg_temp.staff_on(v_org_b);
    v_league := public.league_create(
        p_name        => '[JDL v2] Partage sur demande',
        p_sport_id    => (SELECT id FROM sport WHERE name = 'tennis'),
        p_description => 'Lien partagé par un joueur, pas par l''organisateur : les règles normales s''appliquent. Rejoindre envoie une demande d''approbation au lieu de t''inscrire directement.',
        p_visibility  => 'public',
        p_join_mode   => 'approval');
    PERFORM pg_temp.staff_off(v_org_b);

    PERFORM pg_temp.as_user(v_sharer);
    PERFORM public.league_invite_get_or_create(v_league.id);   -- player link

    -- =====================================================================
    -- C. Member-side session link: jdl's own organizer link on Soir de
    --    feuille, so its session URL lands him straight on the sheet.
    -- =====================================================================
    SELECT * INTO v_league FROM leagues WHERE name = '[JDL v2] Soir de feuille';
    IF v_league.id IS NOT NULL THEN
        PERFORM pg_temp.as_user(v_jdl);
        PERFORM public.league_invite_get_or_create(v_league.id);
    END IF;

    -- =====================================================================
    -- D. Où je joue gets a published session, so Jean can also share a
    --    session from a league he does NOT organize (player-kind link).
    -- =====================================================================
    SELECT * INTO v_league FROM leagues WHERE name = '[JDL v2] Où je joue';
    IF v_league.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM sessions s JOIN seasons se ON se.id = s.season_id
         WHERE se.league_id = v_league.id
    ) THEN
        SELECT * INTO v_season FROM seasons
         WHERE league_id = v_league.id AND status = 'open' LIMIT 1;
        IF v_season.id IS NOT NULL THEN
            PERFORM pg_temp.as_user(v_league.organizer_id);
            v_sess := public.session_create(
                p_season_id    => v_season.id,
                p_name         => 'Jeudi soir',
                p_scheduled_at => now() + interval '5 days');
            v_sess := public.session_publish(v_sess.id, NULL, v_sess.version);
        END IF;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The links to send Jean
-- ---------------------------------------------------------------------------
WITH links AS (
    SELECT l.name, il.kind, il.token, il.league_id,
           (SELECT p.referral_code FROM profile p WHERE p.id = il.created_by) AS code,
           (SELECT s.id FROM sessions s
              JOIN seasons se ON se.id = s.season_id
             WHERE se.league_id = l.id AND s.status = 'published'
             ORDER BY s.scheduled_at LIMIT 1) AS session_id
      FROM league_invite_links il
      JOIN leagues l ON l.id = il.league_id
     WHERE l.name LIKE '[JDL v2]%' AND il.revoked_at IS NULL
)
SELECT name, kind,
       'https://rallia.app/invite/' || code || '?type=league&id=' || league_id ||
         '&share=' || token AS league_url,
       CASE WHEN session_id IS NOT NULL THEN
         'https://rallia.app/invite/' || code || '?type=league&id=' || league_id ||
           '&share=' || token || '&session=' || session_id
       END AS session_url
  FROM links
 ORDER BY name, kind;
