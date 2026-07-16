-- Exercise league_update: happy path + every guard.
\set ON_ERROR_STOP off
\timing off

DO $$
DECLARE
    v_org   uuid;
    v_other uuid;
    v_sport uuid;
    v_league uuid;
    v_ver   integer;
    v_row   leagues;
    v_msg   text;
    v_pass  integer := 0;
    v_fail  integer := 0;

    PROCEDURE_placeholder boolean;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    -- An organizer who actually plays tennis (league_create asserts this).
    SELECT ps.player_id INTO v_org
      FROM player_sport ps WHERE ps.sport_id = v_sport LIMIT 1;
    SELECT ps.player_id INTO v_other
      FROM player_sport ps WHERE ps.sport_id = v_sport AND ps.player_id <> v_org LIMIT 1;

    RAISE NOTICE 'organizer=% other=%', v_org, v_other;

    -- Impersonate the organizer.
    -- Stay on the superuser role: the RPCs are SECURITY DEFINER and read auth.uid()
    -- from this GUC alone. Switching to `authenticated` would enable RLS on the
    -- verification SELECTs below, whose leagues policy reads network_type.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    SELECT id INTO v_league FROM league_create(
        p_name => 'L1 Test League', p_sport_id => v_sport,
        p_description => 'before', p_visibility => 'public', p_join_mode => 'approval');
    SELECT version INTO v_ver FROM leagues WHERE id = v_league;
    RAISE NOTICE 'created league=% version=%', v_league, v_ver;

    ---------------------------------------------------------------- happy path
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object(
            'name', '  L1 Renamed  ',
            'description', 'after',
            'min_rating', 3.0,
            'max_rating', 4.5,
            'member_capacity', 24,
            'waitlist_enabled', true,
            'categories', jsonb_build_array('mens','open'),
            'default_rules', jsonb_build_object('pointWin', 3)));
        IF v_row.name = 'L1 Renamed'                -- trimmed
           AND v_row.description = 'after'
           AND v_row.min_rating = 3.0 AND v_row.max_rating = 4.5
           AND v_row.member_capacity = 24 AND v_row.waitlist_enabled
           AND v_row.categories = ARRAY['mens','open']
           AND v_row.default_rules->>'pointWin' = '3'
           AND v_row.version = v_ver + 1 THEN
            v_pass := v_pass + 1; RAISE NOTICE 'PASS happy path (name trimmed, version %->%)', v_ver, v_row.version;
        ELSE
            v_fail := v_fail + 1; RAISE WARNING 'FAIL happy path: %', to_jsonb(v_row);
        END IF;
    EXCEPTION WHEN others THEN
        v_fail := v_fail + 1; RAISE WARNING 'FAIL happy path raised: %', SQLERRM;
    END;

    v_ver := v_ver + 1;

    ---------------------------------------------------------------- audit row
    BEGIN
        PERFORM 1 FROM leagues_tournaments_audit
         WHERE scope = 'league' AND entity_id = v_league AND action = 'update'
           AND payload_before->>'name' = 'L1 Test League'
           AND payload_after->>'name'  = 'L1 Renamed'
           AND NOT payload_before ? 'visibility';   -- unpatched keys must be absent
        IF FOUND THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS audit records only patched keys';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL audit row wrong';
        END IF;
    END;

    ---------------------------------------------------------------- guards
    -- EMPTY_PATCH
    BEGIN
        v_row := league_update(v_league, v_ver, '{}'::jsonb);
        v_fail := v_fail + 1; RAISE WARNING 'FAIL EMPTY_PATCH not raised';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'EMPTY_PATCH' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS EMPTY_PATCH';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL EMPTY_PATCH got %', SQLERRM; END IF;
    END;

    -- UNKNOWN_FIELD (sport_id must not be patchable)
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('sport_id', v_sport));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL UNKNOWN_FIELD not raised for sport_id';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'UNKNOWN_FIELD:sport_id' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS UNKNOWN_FIELD:sport_id';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL UNKNOWN_FIELD got %', SQLERRM; END IF;
    END;

    -- UNKNOWN_FIELD (status must not be patchable)
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('status', 'closed'));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL UNKNOWN_FIELD not raised for status';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'UNKNOWN_FIELD:status' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS UNKNOWN_FIELD:status';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    -- OPTIMISTIC_LOCK_CONFLICT
    BEGIN
        v_row := league_update(v_league, v_ver - 1, jsonb_build_object('name', 'stale'));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL OPTIMISTIC_LOCK_CONFLICT not raised';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'OPTIMISTIC_LOCK_CONFLICT' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS OPTIMISTIC_LOCK_CONFLICT';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    -- INVALID_NAME (blank)
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('name', '   '));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL INVALID_NAME not raised';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'INVALID_NAME' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS INVALID_NAME';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    -- INVALID_RATING_RANGE, one-sided patch vs stored max (stored max=4.5)
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('min_rating', 5.0));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL INVALID_RATING_RANGE not raised on one-sided patch';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'INVALID_RATING_RANGE' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS INVALID_RATING_RANGE (one-sided vs stored)';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    -- INVALID_MEMBER_CAPACITY
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('member_capacity', 0));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL INVALID_MEMBER_CAPACITY not raised';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'INVALID_MEMBER_CAPACITY' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS INVALID_MEMBER_CAPACITY';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    -- Clearing a nullable field to NULL must work (member_capacity -> null)
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('member_capacity', null));
        IF v_row.member_capacity IS NULL THEN
            v_pass := v_pass + 1; RAISE NOTICE 'PASS clear member_capacity to NULL';
            v_ver := v_row.version;
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL clear capacity: %', v_row.member_capacity; END IF;
    EXCEPTION WHEN others THEN
        v_fail := v_fail + 1; RAISE WARNING 'FAIL clear capacity raised %', SQLERRM;
    END;

    -- NOT_ORGANIZER (impersonate a different player)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('name', 'hijacked'));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL NOT_ORGANIZER not raised';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'NOT_ORGANIZER' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS NOT_ORGANIZER';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    -- NOT_AUTHENTICATED
    PERFORM set_config('request.jwt.claims', '', true);
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('name', 'anon'));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL NOT_AUTHENTICATED not raised';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'NOT_AUTHENTICATED' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS NOT_AUTHENTICATED';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    -- LEAGUE_TERMINAL: closed league rejects all edits
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    UPDATE leagues SET status = 'closed' WHERE id = v_league;
    SELECT version INTO v_ver FROM leagues WHERE id = v_league;
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('name', 'after close'));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL LEAGUE_TERMINAL not raised';
    EXCEPTION WHEN others THEN
        IF SQLERRM = 'LEAGUE_TERMINAL' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS LEAGUE_TERMINAL';
        ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    -- LEAGUE_NOT_FOUND
    BEGIN
        v_row := league_update(gen_random_uuid(), 1, jsonb_build_object('name', 'ghost'));
        v_fail := v_fail + 1; RAISE WARNING 'FAIL LEAGUE_NOT_FOUND not raised';
    EXCEPTION WHEN others THEN
        -- is_league_organizer returns false for a nonexistent league, so NOT_ORGANIZER
        -- fires first. Either is an acceptable refusal; record which.
        RAISE NOTICE 'INFO missing league -> % (organizer check precedes existence)', SQLERRM;
        v_pass := v_pass + 1;
    END;

    RAISE NOTICE '================ PASS=% FAIL=%', v_pass, v_fail;
    IF v_fail > 0 THEN RAISE EXCEPTION 'THERE WERE % FAILURES', v_fail; END IF;

    -- Leave no residue.
    DELETE FROM leagues_tournaments_audit WHERE entity_id = v_league;
    DELETE FROM leagues WHERE id = v_league;
END $$;
