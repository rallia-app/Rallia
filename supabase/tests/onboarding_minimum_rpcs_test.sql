-- ============================================
-- Onboarding minimum RPCs
-- ============================================
-- get_onboarding_gaps() reports exactly what is missing, complete_onboarding()
-- refuses while anything is missing and flips the flag once nothing is, both
-- RPCs hold the caller guard (self / service role; admins read only), and the
-- SQL mirror of MIN_FAVORITE_FACILITIES is the value the spec fixed.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/onboarding_minimum_rpcs_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_p      uuid;   -- a complete, non-admin seeded player
    v_other  uuid;   -- another non-admin player
    v_admin  uuid;
    v_sport  uuid;
    v_fn     text;
    v_cfg    text[];
    v_gaps   text[];
    v_res    jsonb;
    v_raised boolean;
BEGIN
    -- ── 0. Definition hardening ──────────────────────────────────────────────
    FOREACH v_fn IN ARRAY ARRAY[
        'public.min_favorite_facilities()',
        'public.get_onboarding_gaps(uuid)',
        'public.complete_onboarding(uuid)'
    ] LOOP
        ASSERT NOT has_function_privilege('anon', v_fn, 'EXECUTE'), v_fn || ': anon cannot execute';
        ASSERT has_function_privilege('authenticated', v_fn, 'EXECUTE'), v_fn || ': authenticated can execute';
        SELECT proconfig INTO v_cfg FROM pg_proc WHERE oid = v_fn::regprocedure;
        ASSERT v_cfg @> ARRAY['search_path=public'], v_fn || ': search_path pinned';
    END LOOP;
    ASSERT public.min_favorite_facilities() = 2, 'MIN_FAVORITE_FACILITIES mirror is 2';

    -- ── 1. Fixture: a seeded non-admin player who already satisfies the invariant
    SELECT pl.id INTO v_p
    FROM player pl
    JOIN profile pr ON pr.id = pl.id
    WHERE NOT public.is_admin(pl.id)
      AND pl.postal_code IS NOT NULL AND btrim(pl.postal_code) <> ''
      AND pl.latitude IS NOT NULL AND pl.longitude IS NOT NULL
      AND EXISTS (SELECT 1 FROM player_sport ps WHERE ps.player_id = pl.id)
      AND NOT EXISTS (SELECT 1 FROM player_sport ps WHERE ps.player_id = pl.id AND ps.active_rating_score_id IS NULL)
      AND NOT EXISTS (
            SELECT 1 FROM player_sport ps
            WHERE ps.player_id = pl.id
              AND (SELECT count(*) FROM player_favorite_facility f
                   WHERE f.player_id = pl.id AND f.sport_id = ps.sport_id) < public.min_favorite_facilities())
    ORDER BY pl.id LIMIT 1;
    ASSERT v_p IS NOT NULL, 'seed needs one complete non-admin player';

    SELECT id INTO v_other FROM player WHERE NOT public.is_admin(id) AND id <> v_p ORDER BY id LIMIT 1;
    ASSERT v_other IS NOT NULL, 'seed needs a second non-admin player';

    SELECT ps.sport_id INTO v_sport FROM player_sport ps WHERE ps.player_id = v_p ORDER BY ps.is_primary DESC NULLS LAST LIMIT 1;

    -- ── 2. Complete player: no gaps, completion ok and idempotent ───────────
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p::text)::text, true);

    v_gaps := public.get_onboarding_gaps();
    ASSERT cardinality(v_gaps) = 0, format('complete player has no gaps, got %s', v_gaps);

    UPDATE profile SET onboarding_completed = false WHERE id = v_p;
    v_res := public.complete_onboarding();
    ASSERT (v_res->>'ok')::boolean, format('complete player completes, got %s', v_res);
    ASSERT (SELECT onboarding_completed FROM profile WHERE id = v_p), 'flag flipped';
    v_res := public.complete_onboarding();
    ASSERT (v_res->>'ok')::boolean, 'second call is idempotent';

    -- ── 3. Each missing requirement is reported and blocks completion ───────
    UPDATE profile SET onboarding_completed = false WHERE id = v_p;

    -- favourites below the minimum for one sport
    DELETE FROM player_favorite_facility WHERE player_id = v_p AND sport_id = v_sport;
    v_gaps := public.get_onboarding_gaps();
    ASSERT v_gaps @> ARRAY['favorites:' || v_sport::text], format('missing favourites reported, got %s', v_gaps);
    v_res := public.complete_onboarding();
    ASSERT NOT (v_res->>'ok')::boolean, 'refused without favourites';
    ASSERT v_res->'missing' ? ('favorites:' || v_sport::text), format('missing list names the sport, got %s', v_res);
    ASSERT NOT (SELECT onboarding_completed FROM profile WHERE id = v_p), 'flag not flipped on refusal';

    -- unrated sport
    UPDATE player_sport SET active_rating_score_id = NULL WHERE player_id = v_p AND sport_id = v_sport;
    v_gaps := public.get_onboarding_gaps();
    ASSERT v_gaps @> ARRAY['rating:' || v_sport::text], format('unrated sport reported, got %s', v_gaps);

    -- no postal code / no coordinates
    UPDATE player SET postal_code = '' WHERE id = v_p;
    v_gaps := public.get_onboarding_gaps();
    ASSERT v_gaps @> ARRAY['postal_code'], format('missing postal code reported, got %s', v_gaps);
    UPDATE player SET postal_code = 'H2X 1Y4', latitude = NULL WHERE id = v_p;
    v_gaps := public.get_onboarding_gaps();
    ASSERT v_gaps @> ARRAY['postal_code'], format('missing coordinates count as missing postal code, got %s', v_gaps);

    -- no sport at all: short-circuits to sport (no per-sport codes possible)
    DELETE FROM player_sport WHERE player_id = v_p;
    v_gaps := public.get_onboarding_gaps();
    ASSERT v_gaps @> ARRAY['sport'], format('no sport reported, got %s', v_gaps);
    ASSERT NOT EXISTS (SELECT 1 FROM unnest(v_gaps) g WHERE g LIKE 'rating:%' OR g LIKE 'favorites:%'),
        'no per-sport codes when there is no sport';
    v_res := public.complete_onboarding();
    ASSERT NOT (v_res->>'ok')::boolean, 'refused with no sport';

    -- ── 4. Caller guard ─────────────────────────────────────────────────────
    -- another player may neither read nor complete for v_p
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
    v_raised := false;
    BEGIN
        PERFORM public.get_onboarding_gaps(v_p);
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'another player cannot read gaps';
    v_raised := false;
    BEGIN
        PERFORM public.complete_onboarding(v_p);
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'another player cannot complete';

    -- unauthenticated: refused
    PERFORM set_config('request.jwt.claims', '', true);
    v_raised := false;
    BEGIN
        PERFORM public.get_onboarding_gaps();
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'anonymous call refused';

    -- service role may act for anyone (web API routes)
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    v_gaps := public.get_onboarding_gaps(v_p);
    ASSERT v_gaps @> ARRAY['sport'], 'service role reads gaps for any player';
    v_res := public.complete_onboarding(v_p);
    ASSERT NOT (v_res->>'ok')::boolean, 'service role is held to the same invariant';

    -- an admin may read but not complete for another player
    SELECT id INTO v_admin FROM player WHERE public.is_admin(id) ORDER BY id LIMIT 1;
    IF v_admin IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
        v_gaps := public.get_onboarding_gaps(v_p);
        ASSERT v_gaps @> ARRAY['sport'], 'admin reads gaps for any player';
        v_raised := false;
        BEGIN
            PERFORM public.complete_onboarding(v_p);
        EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
        END;
        ASSERT v_raised, 'admin cannot complete on a player''s behalf';
    END IF;

    -- unknown player: reported as missing everything, never an error for service role
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    v_gaps := public.get_onboarding_gaps(gen_random_uuid());
    ASSERT v_gaps @> ARRAY['postal_code', 'sport'], format('unknown player is missing everything, got %s', v_gaps);

    RAISE NOTICE 'onboarding_minimum_rpcs_test: all assertions passed';
END $$;

ROLLBACK;
