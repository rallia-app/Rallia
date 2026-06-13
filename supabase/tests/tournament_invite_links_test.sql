-- ============================================
-- Tournament invite links — DB-level integration test
-- ============================================
-- Exercises the four invite-link RPCs (20260612150000) against a live
-- database: mint idempotency, organizer gating, private-tournament preview
-- via token (RLS bypass), registration-mode bypass on join, idempotent
-- re-tap, withdraw/rejoin reactivation, sport scope, reset rotation, closed
-- registration, and audit rows.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_invite_links_test.sql
--
-- Runs inside one transaction and ROLLBACKs at the end. Auth is simulated
-- via the request.jwt.claims GUC; RLS is checked under SET LOCAL ROLE
-- authenticated. Fixture players are picked non-admin (is_admin bypasses
-- organizer gating) and the sport-mismatch caller is the seeded admin,
-- who has no tennis player_sport row here.
-- ============================================

BEGIN;
DO $$
DECLARE
  v_sport uuid;
  v_org uuid;
  v_p2 uuid;
  v_p3 uuid;
  v_t tournaments;
  v_link tournament_invite_links;
  v_link2 tournament_invite_links;
  v_old_token text;
  v_prev jsonb;
  v_reg tournament_registrations;
  v_reg2 tournament_registrations;
  v_n integer;
BEGIN
  SELECT id INTO v_sport FROM sport WHERE name = 'tennis' LIMIT 1;
  SELECT id INTO v_org FROM player WHERE NOT public.is_admin(id) ORDER BY id LIMIT 1;
  SELECT id INTO v_p2 FROM player WHERE NOT public.is_admin(id) ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_p3 FROM player WHERE public.is_admin(id) ORDER BY id LIMIT 1;
  ASSERT v_org IS NOT NULL AND v_p2 IS NOT NULL AND v_p3 IS NOT NULL, 'need 3 players';

  INSERT INTO player_sport (player_id, sport_id, is_active) VALUES
    (v_org, v_sport, true), (v_p2, v_sport, true)
  ON CONFLICT (player_id, sport_id) DO UPDATE SET is_active = true;
  DELETE FROM player_sport WHERE player_id = v_p3 AND sport_id = v_sport;

  -- Private + approval mode: the strictest case the link must bypass.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role','authenticated')::text, true);
  v_t := tournament_create('Invite Cup', v_sport, 4::smallint,
          now() + interval '7 days', now() + interval '8 days',
          NULL, 'private'::tournament_visibility, 'approval'::tournament_registration_mode);
  v_t := tournament_open_registration(v_t.id, v_t.version);

  -- 1. get_or_create is idempotent and mints a 32-char token
  v_link := tournament_invite_get_or_create(v_t.id);
  ASSERT length(v_link.token) = 32, 'token not 32 chars';
  v_link2 := tournament_invite_get_or_create(v_t.id);
  ASSERT v_link.id = v_link2.id, 'get_or_create not idempotent';

  -- 2. non-organizer cannot mint
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role','authenticated')::text, true);
  BEGIN
    PERFORM tournament_invite_get_or_create(v_t.id);
    RAISE EXCEPTION 'non-organizer minted';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'NOT_ORGANIZER', 'wrong error: ' || SQLERRM;
  END;

  -- 3. token preview reveals the private tournament + count; direct reads stay RLS-hidden
  v_prev := tournament_get_by_invite_token(v_link.token);
  ASSERT v_prev->'tournament'->>'name' = 'Invite Cup', 'preview name wrong';
  ASSERT (v_prev->>'active_count')::int = 0, 'preview count wrong';
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM tournament_invite_links WHERE id = v_link.id;
  ASSERT v_n = 0, 'RLS leaked link row to non-organizer';
  SELECT count(*) INTO v_n FROM tournaments WHERE id = v_t.id;
  ASSERT v_n = 0, 'RLS leaked private tournament';
  RESET ROLE;

  -- 4. join on approval-mode tournament: registered immediately, uses=1
  v_reg := tournament_join_via_invite(v_link.token);
  ASSERT v_reg.status = 'registered', 'mode not bypassed: ' || v_reg.status;
  SELECT * INTO v_link FROM tournament_invite_links WHERE id = v_link.id;
  ASSERT v_link.uses = 1, 'uses not incremented';

  -- 5. idempotent re-tap: same row, uses unchanged
  v_reg2 := tournament_join_via_invite(v_link.token);
  ASSERT v_reg2.id = v_reg.id, 're-tap created new row';
  SELECT * INTO v_link FROM tournament_invite_links WHERE id = v_link.id;
  ASSERT v_link.uses = 1, 'uses bumped on re-tap';

  -- 6. after joining, the registrant sees the private tournament directly
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM tournaments WHERE id = v_t.id;
  ASSERT v_n = 1, 'registrant cannot see private tournament';
  RESET ROLE;

  -- 7. withdraw then rejoin reactivates the same row
  v_reg2 := tournament_withdraw(v_reg.id, v_reg.version);
  v_reg2 := tournament_join_via_invite(v_link.token);
  ASSERT v_reg2.id = v_reg.id AND v_reg2.status = 'registered', 'reactivation failed';
  SELECT * INTO v_link FROM tournament_invite_links WHERE id = v_link.id;
  ASSERT v_link.uses = 2, 'uses not bumped on reactivation';

  -- 8. caller without the sport is rejected
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p3, 'role','authenticated')::text, true);
  BEGIN
    PERFORM tournament_join_via_invite(v_link.token);
    RAISE EXCEPTION 'sport mismatch not enforced';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%SPORT_MISMATCH%', 'wrong error: ' || SQLERRM;
  END;

  -- 9. reset rotates: old token dies, new token still previews
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role','authenticated')::text, true);
  v_old_token := v_link.token;
  v_link2 := tournament_invite_reset(v_t.id);
  ASSERT v_link2.token <> v_old_token, 'reset did not rotate';
  BEGIN
    PERFORM tournament_get_by_invite_token(v_old_token);
    RAISE EXCEPTION 'revoked token still previews';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'INVITE_INVALID', 'wrong error: ' || SQLERRM;
  END;
  v_prev := tournament_get_by_invite_token(v_link2.token);
  ASSERT (v_prev->>'active_count')::int = 1, 'new token preview broken';

  -- 9b. organizer removal is permanent: a disqualified player re-tapping the
  -- link gets REGISTRATION_REMOVED, not a silent reactivation
  SELECT * INTO v_reg FROM tournament_registrations
   WHERE tournament_id = v_t.id AND user_id = v_p2;
  PERFORM tournament_remove_registration(v_reg.id, v_reg.version);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role','authenticated')::text, true);
  BEGIN
    PERFORM tournament_join_via_invite(v_link2.token);
    RAISE EXCEPTION 'disqualified player rejoined via invite';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'REGISTRATION_REMOVED', 'wrong error: ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role','authenticated')::text, true);

  -- 10. closed registration surfaces TOURNAMENT_REG_CLOSED, not INVITE_INVALID
  SELECT * INTO v_t FROM tournaments WHERE id = v_t.id;
  PERFORM tournament_close_registration(v_t.id, v_t.version);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p3, 'role','authenticated')::text, true);
  INSERT INTO player_sport (player_id, sport_id, is_active) VALUES (v_p3, v_sport, true)
  ON CONFLICT (player_id, sport_id) DO UPDATE SET is_active = true;
  BEGIN
    PERFORM tournament_join_via_invite(v_link2.token);
    RAISE EXCEPTION 'closed reg not enforced';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'TOURNAMENT_REG_CLOSED', 'wrong error: ' || SQLERRM;
  END;

  -- 11. audit rows for mint, reset, and joins
  SELECT count(*) INTO v_n FROM leagues_tournaments_audit
   WHERE entity_id = v_t.id AND action IN ('invite_link_created','invite_link_reset');
  ASSERT v_n = 2, 'mint/reset audit missing';
  SELECT count(*) INTO v_n FROM leagues_tournaments_audit WHERE action = 'register_via_invite';
  ASSERT v_n >= 2, 'join audit missing';

  RAISE NOTICE 'ALL INVITE LINK TESTS PASSED';
END $$;
ROLLBACK;
