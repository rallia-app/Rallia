-- ============================================
-- Leagues — shareable invite links
-- ============================================
-- Covers 20260809150000: mint kinds, player-mint safety gates, redeem
-- semantics per kind (skeleton key vs delegated league_join), capacity,
-- idempotency, reset scope, and the RLS-bypassing preview.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_share_links_test.sql
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

-- Admins bypass is_admin() gates and sort first in the seed, so every fixture
-- player here is deliberately a non-admin.
CREATE OR REPLACE FUNCTION pg_temp.tennis_players(n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id
      FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active = true AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t;
$$;

DO $$
DECLARE
    v_p        uuid[];
    v_org      uuid;
    v_sport    uuid;
    v_pub      leagues;   -- public / approval
    v_priv     leagues;   -- private / open
    v_invonly  leagues;   -- public / invite_only
    v_cap      leagues;   -- public / open, capacity 1
    v_olink    league_invite_links;
    v_plink    league_invite_links;
    v_link     league_invite_links;
    v_m        league_members;
    v_m2       league_members;
    v_preview  jsonb;
    v_err      text;
    v_uses     integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    v_p := pg_temp.tennis_players(6);
    v_org := v_p[1];
    PERFORM pg_temp.as_user(v_org);

    v_pub     := public.league_create('Share pub',  v_sport, p_visibility => 'public',  p_join_mode => 'approval');
    v_priv    := public.league_create('Share priv', v_sport, p_visibility => 'private', p_join_mode => 'open');
    v_invonly := public.league_create('Share invo', v_sport, p_visibility => 'public',  p_join_mode => 'invite_only');
    v_cap     := public.league_create('Share cap',  v_sport, p_visibility => 'public',  p_join_mode => 'open');
    -- Capacity 2: the organizer's own seat (population invariant) plus one.
    SELECT * INTO v_cap FROM league_update(v_cap.id, v_cap.version,
        jsonb_build_object('member_capacity', 2, 'waitlist_enabled', false));

    -- ---------------------------------------------------------------------
    -- 1. Mint: caller's rights decide the kind, re-mint is stable
    -- ---------------------------------------------------------------------
    v_olink := public.league_invite_get_or_create(v_pub.id);
    IF v_olink.kind <> 'organizer' THEN
        RAISE EXCEPTION 'organizer mint got kind %', v_olink.kind;
    END IF;
    v_link := public.league_invite_get_or_create(v_pub.id);
    IF v_link.id <> v_olink.id THEN
        RAISE EXCEPTION 're-mint minted a second organizer link';
    END IF;

    PERFORM pg_temp.as_user(v_p[2]);
    v_plink := public.league_invite_get_or_create(v_pub.id);
    IF v_plink.kind <> 'player' OR v_plink.token = v_olink.token THEN
        RAISE EXCEPTION 'player mint wrong: kind %, token clash %',
            v_plink.kind, (v_plink.token = v_olink.token);
    END IF;
    v_link := public.league_invite_get_or_create(v_pub.id);
    IF v_link.id <> v_plink.id THEN
        RAISE EXCEPTION 're-mint minted a second player link';
    END IF;
    RAISE NOTICE 'ok 1: organizer and player kinds mint per caller, idempotently';

    -- ---------------------------------------------------------------------
    -- 2. Player mint refused where sharing is unsafe or leads nowhere
    -- ---------------------------------------------------------------------
    BEGIN
        PERFORM public.league_invite_get_or_create(v_priv.id);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err NOT LIKE '%SHARING_NOT_AVAILABLE%' THEN
        RAISE EXCEPTION 'private league player mint: %', v_err;
    END IF;

    BEGIN
        PERFORM public.league_invite_get_or_create(v_invonly.id);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err NOT LIKE '%SHARING_NOT_AVAILABLE%' THEN
        RAISE EXCEPTION 'invite_only league player mint: %', v_err;
    END IF;
    RAISE NOTICE 'ok 2: player links exist only on public, non-invite-only leagues';

    -- ---------------------------------------------------------------------
    -- 3. Preview bypasses RLS, one opaque failure for bad tokens
    -- ---------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_org);
    v_link := public.league_invite_get_or_create(v_priv.id);   -- organizer link on the private league

    -- (RLS itself is not assertable here — the suite runs as superuser — but
    -- the preview RPC is what a token holder calls either way.)
    PERFORM pg_temp.as_user(v_p[3]);
    v_preview := public.league_get_by_invite_token(v_link.token);
    -- active_count = 1: league_create seats the organizer as an active member.
    IF (v_preview -> 'league' ->> 'id')::uuid <> v_priv.id
       OR (v_preview ->> 'active_count')::int <> 1 THEN
        RAISE EXCEPTION 'preview payload wrong: %', v_preview;
    END IF;

    BEGIN
        PERFORM public.league_get_by_invite_token('nope');
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err NOT LIKE '%INVITE_INVALID%' THEN
        RAISE EXCEPTION 'bad token preview: %', v_err;
    END IF;
    RAISE NOTICE 'ok 3: preview reveals a private league to a valid token holder only';

    -- ---------------------------------------------------------------------
    -- 4. Player link redeems through the NORMAL rules: approval -> pending
    -- ---------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_p[3]);
    v_m := public.league_join_via_invite(v_plink.token);
    IF v_m.status <> 'pending' THEN
        RAISE EXCEPTION 'player link on approval league landed %', v_m.status;
    END IF;
    SELECT uses INTO v_uses FROM league_invite_links WHERE id = v_plink.id;
    IF v_uses <> 1 THEN
        RAISE EXCEPTION 'player link uses = %', v_uses;
    END IF;

    -- Re-tap: idempotent, no double count.
    v_m2 := public.league_join_via_invite(v_plink.token);
    IF v_m2.id <> v_m.id OR v_m2.status <> 'pending' THEN
        RAISE EXCEPTION 're-tap changed the row: % %', v_m2.id, v_m2.status;
    END IF;
    SELECT uses INTO v_uses FROM league_invite_links WHERE id = v_plink.id;
    IF v_uses <> 1 THEN
        RAISE EXCEPTION 're-tap bumped uses to %', v_uses;
    END IF;
    RAISE NOTICE 'ok 4: player link lands pending on an approval league, idempotently';

    -- ---------------------------------------------------------------------
    -- 5. Organizer link is the skeleton key: straight to active, even on the
    --    approval league, and it admits an already-pending request too
    -- ---------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_p[4]);
    v_m := public.league_join_via_invite(v_olink.token);
    IF v_m.status <> 'active' THEN
        RAISE EXCEPTION 'organizer link on approval league landed %', v_m.status;
    END IF;

    -- p3's pending self-request from step 4: the organizer link admits it.
    PERFORM pg_temp.as_user(v_p[3]);
    v_m := public.league_join_via_invite(v_olink.token);
    IF v_m.status <> 'active' OR v_m.approved_at IS NULL THEN
        RAISE EXCEPTION 'organizer link left the pending request as %', v_m.status;
    END IF;
    RAISE NOTICE 'ok 5: organizer link admits past approval, including pending requests';

    -- ---------------------------------------------------------------------
    -- 6. Organizer link works on an invite_only league too
    -- ---------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_org);
    v_link := public.league_invite_get_or_create(v_invonly.id);
    PERFORM pg_temp.as_user(v_p[5]);
    v_m := public.league_join_via_invite(v_link.token);
    IF v_m.status <> 'active' THEN
        RAISE EXCEPTION 'organizer link on invite_only league landed %', v_m.status;
    END IF;
    RAISE NOTICE 'ok 6: organizer link admits into an invite_only league';

    -- ---------------------------------------------------------------------
    -- 7. Capacity binds both kinds — the skeleton key never oversells seats
    -- ---------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_org);
    v_link := public.league_invite_get_or_create(v_cap.id);
    PERFORM pg_temp.as_user(v_p[2]);
    PERFORM public.league_join(v_cap.id);          -- fills the only seat

    PERFORM pg_temp.as_user(v_p[3]);
    BEGIN
        PERFORM public.league_join_via_invite(v_link.token);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err NOT LIKE '%LEAGUE_FULL%' THEN
        RAISE EXCEPTION 'organizer link past capacity: %', v_err;
    END IF;

    -- With a waitlist, the same redeem queues instead.
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_cap FROM leagues WHERE id = v_cap.id;
    SELECT * INTO v_cap FROM league_update(v_cap.id, v_cap.version,
        jsonb_build_object('waitlist_enabled', true));
    PERFORM pg_temp.as_user(v_p[3]);
    v_m := public.league_join_via_invite(v_link.token);
    IF v_m.status <> 'pending' OR NOT EXISTS (
        SELECT 1 FROM league_member_waitlist
         WHERE league_id = v_cap.id AND user_id = v_p[3] AND promoted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'full-league redeem did not queue: %', v_m.status;
    END IF;

    -- And an organizer link cannot promote a queued hold past the cap.
    BEGIN
        PERFORM public.league_join_via_invite(v_link.token);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err NOT LIKE '%LEAGUE_FULL%' THEN
        RAISE EXCEPTION 'organizer link promoted a queued hold: %', v_err;
    END IF;
    RAISE NOTICE 'ok 7: capacity binds both kinds; full leagues queue, never oversell';

    -- ---------------------------------------------------------------------
    -- 8. Reset revokes the organizer link ONLY; player links keep working
    -- ---------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_org);
    v_link := public.league_invite_reset(v_pub.id);
    IF v_link.token = v_olink.token THEN
        RAISE EXCEPTION 'reset returned the old token';
    END IF;

    PERFORM pg_temp.as_user(v_p[6]);
    BEGIN
        PERFORM public.league_get_by_invite_token(v_olink.token);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err NOT LIKE '%INVITE_INVALID%' THEN
        RAISE EXCEPTION 'old organizer token survived reset: %', v_err;
    END IF;

    v_preview := public.league_get_by_invite_token(v_plink.token);
    IF (v_preview -> 'league' ->> 'id')::uuid <> v_pub.id THEN
        RAISE EXCEPTION 'reset broke the player link';
    END IF;
    RAISE NOTICE 'ok 8: reset rotates the organizer link and spares player links';

    -- ---------------------------------------------------------------------
    -- 9. A league gone private kills a circulating player link, not the
    --    organizer one
    -- ---------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_pub FROM leagues WHERE id = v_pub.id;
    SELECT * INTO v_pub FROM league_update(v_pub.id, v_pub.version,
        jsonb_build_object('visibility', 'private'));

    PERFORM pg_temp.as_user(v_p[6]);
    BEGIN
        PERFORM public.league_join_via_invite(v_plink.token);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err NOT LIKE '%SHARING_NOT_AVAILABLE%' THEN
        RAISE EXCEPTION 'player link on now-private league: %', v_err;
    END IF;

    v_m := public.league_join_via_invite(v_link.token);
    IF v_m.status <> 'active' THEN
        RAISE EXCEPTION 'organizer link on now-private league landed %', v_m.status;
    END IF;
    RAISE NOTICE 'ok 9: going private disables player links, organizer link survives';

    RAISE NOTICE 'league_share_links_test: ALL OK';
END $$;

ROLLBACK;
