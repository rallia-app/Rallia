-- ============================================
-- tournament_join_via_invite — overload-uniqueness regression
-- ============================================
-- Guards the fix in 20260721140000: there must be exactly ONE
-- tournament_join_via_invite overload, so a token-only call (the singles
-- share-link join path) resolves to a single candidate instead of failing
-- with PGRST203 (PostgREST) / SQLSTATE 42725 (plpgsql, "function is not
-- unique"). A resurrected second overload — as 20260710130000 introduced —
-- makes both assertions below fail.
--
-- Self-contained: needs no seed data. Runs inside one transaction and
-- ROLLBACKs. Run against a local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_join_via_invite_overload_test.sql
-- ============================================

BEGIN;
DO $$
DECLARE
  v_n integer;
BEGIN
  -- Exactly one overload may exist.
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'tournament_join_via_invite';
  ASSERT v_n = 1,
    'expected exactly 1 tournament_join_via_invite overload, found ' || v_n;

  -- A token-only call must resolve to that single candidate and run. With the
  -- ambiguous overload present this raised 42725 before executing; now it runs
  -- and rejects the bogus token with INVITE_INVALID.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
    true
  );
  BEGIN
    PERFORM public.tournament_join_via_invite('nonexistent-regression-token');
    RAISE EXCEPTION 'expected INVITE_INVALID, call unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLSTATE <> '42725',
      'overload ambiguity resurfaced: 42725 function is not unique';
    ASSERT SQLERRM = 'INVITE_INVALID',
      'unexpected error: ' || SQLERRM || ' (' || SQLSTATE || ')';
  END;

  RAISE NOTICE 'JOIN-VIA-INVITE OVERLOAD REGRESSION PASSED';
END $$;
ROLLBACK;
