-- ============================================
-- Account deletion — blockers report + audit FKs release the player (DB-level)
-- ============================================
-- Covers 20260821160000_account_deletion_blockers.
--
-- delete-account calls auth.admin.deleteUser and trusted the cascade. The L&T
-- tables reference player with RESTRICT, and a handful of nullable "who did
-- it" columns were NO ACTION, so the edge function answered 500 for anyone
-- with a tournament or league footprint (Sentry REACT-NATIVE-EA).
--
--   * the eight nullable audit columns now SET NULL on player delete
--   * account_deletion_blockers() flags a tournament organizer and says why
--   * deleting that organizer still fails with foreign_key_violation (RESTRICT kept)
--   * a player with no L&T footprint reports ok and the delete goes through
--   * an unknown id reports ok with zero counts
--   * only service_role may execute the function
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/account_deletion_blockers_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

-- 1. The audit columns release the player (SET NULL) and all eight still exist.
DO $$
DECLARE
  v_names text[] := ARRAY[
    'tournament_registrations_approved_by_fkey',
    'league_members_approved_by_fkey',
    'season_members_invited_by_fkey',
    'season_members_approved_by_fkey',
    'session_presence_guest_invited_by_fkey',
    'session_match_scores_validated_by_fkey',
    'tournament_match_scores_validated_by_fkey',
    'match_time_suggestion_resolved_by_fkey'
  ];
  v_count int;
  v_bad   text;
BEGIN
  SELECT count(*) INTO v_count FROM pg_constraint WHERE conname = ANY (v_names);
  ASSERT v_count = 8, format('expected 8 audit FKs, found %s', v_count);

  SELECT string_agg(conname, ', ') INTO v_bad
  FROM pg_constraint
  WHERE conname = ANY (v_names) AND confdeltype <> 'n';
  ASSERT v_bad IS NULL, format('audit FKs not ON DELETE SET NULL: %s', v_bad);
END $$;

-- 2. Service role only.
DO $$
BEGIN
  ASSERT has_function_privilege('service_role', 'public.account_deletion_blockers(uuid)', 'EXECUTE'),
    'service_role must be able to execute account_deletion_blockers';
  ASSERT NOT has_function_privilege('authenticated', 'public.account_deletion_blockers(uuid)', 'EXECUTE'),
    'authenticated must not execute account_deletion_blockers';
  ASSERT NOT has_function_privilege('anon', 'public.account_deletion_blockers(uuid)', 'EXECUTE'),
    'anon must not execute account_deletion_blockers';
END $$;

-- 3. A tournament organizer is blocked, the report says why, and the database
--    agrees: the delete is refused by RESTRICT rather than going through.
DO $$
DECLARE
  v_org uuid;
  v_res jsonb;
BEGIN
  SELECT t.organizer_id INTO v_org
  FROM public.tournaments t
  JOIN auth.users u ON u.id = t.organizer_id
  LIMIT 1;
  ASSERT v_org IS NOT NULL, 'seed has no tournament organizer with an auth row';

  v_res := public.account_deletion_blockers(v_org);
  ASSERT (v_res->>'ok')::boolean IS FALSE, 'organizer should be blocked';
  ASSERT (v_res->>'organized_tournaments')::int > 0,
    format('organized_tournaments should be reported, got %s', v_res);

  BEGIN
    DELETE FROM auth.users WHERE id = v_org;
    RAISE EXCEPTION 'organizer delete unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- expected: RESTRICT still protects organized events
  END;
END $$;

-- 4. A player with no L&T footprint reports ok, and the delete really works.
DO $$
DECLARE
  v_clean uuid;
  v_res   jsonb;
BEGIN
  SELECT p.id INTO v_clean
  FROM public.player p
  JOIN auth.users u ON u.id = p.id
  WHERE (public.account_deletion_blockers(p.id)->>'ok')::boolean
  LIMIT 1;
  ASSERT v_clean IS NOT NULL, 'seed has no player without L&T records';

  v_res := public.account_deletion_blockers(v_clean);
  ASSERT (v_res->>'ok')::boolean, format('clean player should be ok, got %s', v_res);

  DELETE FROM auth.users WHERE id = v_clean;
  ASSERT NOT EXISTS (SELECT 1 FROM public.player WHERE id = v_clean),
    'player row should cascade away with auth.users';
END $$;

-- 5. Unknown id: ok, every count zero.
DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.account_deletion_blockers(gen_random_uuid());
  ASSERT (v_res->>'ok')::boolean, 'unknown id should be ok';
  ASSERT (v_res->>'tournament_registrations')::int = 0
     AND (v_res->>'organized_tournaments')::int = 0
     AND (v_res->>'payments')::int = 0,
    format('unknown id should report zero counts, got %s', v_res);
END $$;

ROLLBACK;
