-- L2: league_pause / league_resume / league_close + 'paused' enforcement.
DO $$
DECLARE
    v_org uuid; v_other uuid; v_sport uuid;
    v_league uuid; v_ver integer; v_season seasons; v_row leagues;
    v_pass integer := 0; v_fail integer := 0;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    SELECT ps.player_id INTO v_org FROM player_sport ps WHERE ps.sport_id=v_sport LIMIT 1;
    SELECT ps.player_id INTO v_other FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id<>v_org LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    SELECT id INTO v_league FROM league_create(
        p_name=>'L2 Lifecycle', p_sport_id=>v_sport, p_visibility=>'public', p_join_mode=>'open');
    SELECT version INTO v_ver FROM leagues WHERE id=v_league;

    ---------------------------------------------------------------- pause
    BEGIN
        v_row := league_pause(v_league, v_ver);
        IF v_row.status='paused' AND v_row.version=v_ver+1 THEN
            v_pass:=v_pass+1; RAISE NOTICE 'PASS pause active->paused';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL pause: %', v_row.status; END IF;
    EXCEPTION WHEN others THEN v_fail:=v_fail+1; RAISE WARNING 'FAIL pause raised %', SQLERRM; END;
    v_ver := v_ver+1;

    -- double pause
    BEGIN
        v_row := league_pause(v_league, v_ver);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL double-pause allowed';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_NOT_ACTIVE' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS double-pause -> LEAGUE_NOT_ACTIVE';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL double-pause got %', SQLERRM; END IF;
    END;

    ------------------------------------------- paused blocks joins (pre-existing guard)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
    BEGIN
        PERFORM league_join(v_league);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL paused league accepted a join';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_NOT_ACTIVE' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS paused blocks league_join';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL join got %', SQLERRM; END IF;
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    ------------------------------------------- paused blocks season_create (pre-existing)
    BEGIN
        PERFORM season_create(v_league, 'S1', current_date, current_date + 60);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL paused league accepted season_create';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_NOT_ACTIVE' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS paused blocks season_create';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL season_create got %', SQLERRM; END IF;
    END;

    ---------------------------------------------------------------- resume
    BEGIN
        v_row := league_resume(v_league, v_ver);
        IF v_row.status='active' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS resume paused->active';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL resume: %', v_row.status; END IF;
    EXCEPTION WHEN others THEN v_fail:=v_fail+1; RAISE WARNING 'FAIL resume raised %', SQLERRM; END;
    v_ver := v_ver+1;

    -- resume an active league
    BEGIN
        v_row := league_resume(v_league, v_ver);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL resume-when-active allowed';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_NOT_PAUSED' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS resume-when-active -> LEAGUE_NOT_PAUSED';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    ------------------------------------------- NEW GUARD: paused blocks season_open
    v_season := season_create(v_league, 'S1', current_date, current_date + 60);
    v_row := league_pause(v_league, v_ver); v_ver := v_ver+1;
    BEGIN
        PERFORM season_open(v_season.id, v_season.version);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL paused league allowed season_open';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_NOT_ACTIVE' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [new guard] paused blocks season_open';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL season_open got %', SQLERRM; END IF;
    END;
    v_row := league_resume(v_league, v_ver); v_ver := v_ver+1;

    ------------------------------------------- NEW GUARD: paused blocks session_create
    v_season := season_open(v_season.id, v_season.version);
    v_row := league_pause(v_league, v_ver); v_ver := v_ver+1;
    BEGIN
        PERFORM session_create(v_season.id, 'Sess 1', now() + interval '3 days');
        v_fail:=v_fail+1; RAISE WARNING 'FAIL paused league allowed session_create';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_NOT_ACTIVE' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [new guard] paused blocks session_create';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL session_create got %', SQLERRM; END IF;
    END;
    v_row := league_resume(v_league, v_ver); v_ver := v_ver+1;

    -- ...and an ACTIVE league still allows session_create (guard isn't over-broad)
    BEGIN
        PERFORM session_create(v_season.id, 'Sess 1', now() + interval '3 days');
        v_pass:=v_pass+1; RAISE NOTICE 'PASS active league still allows session_create';
    EXCEPTION WHEN others THEN
        v_fail:=v_fail+1; RAISE WARNING 'FAIL active session_create raised %', SQLERRM;
    END;

    ---------------------------------------------------------------- close
    -- season is still open -> must refuse
    BEGIN
        v_row := league_close(v_league, 'done', v_ver);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL closed a league with an open season';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_HAS_OPEN_SEASONS' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS close refused: LEAGUE_HAS_OPEN_SEASONS';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL close got %', SQLERRM; END IF;
    END;

    -- close the season, then the league closes
    UPDATE seasons SET status='closed' WHERE id=v_season.id;
    BEGIN
        v_row := league_close(v_league, 'season over', v_ver);
        IF v_row.status='closed' AND v_row.closed_at IS NOT NULL AND v_row.closed_reason='season over' THEN
            v_pass:=v_pass+1; RAISE NOTICE 'PASS close sets status/closed_at/closed_reason';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL close row: %', to_jsonb(v_row); END IF;
    EXCEPTION WHEN others THEN v_fail:=v_fail+1; RAISE WARNING 'FAIL close raised %', SQLERRM; END;
    v_ver := v_ver+1;

    -- closed is terminal: no resume, no pause, no edit
    BEGIN
        v_row := league_resume(v_league, v_ver);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL resumed a CLOSED league';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_NOT_PAUSED' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS closed league cannot resume (terminal)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;
    BEGIN
        v_row := league_close(v_league, 'again', v_ver);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL double-close allowed';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_NOT_CLOSABLE' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS double-close -> LEAGUE_NOT_CLOSABLE';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;
    BEGIN
        v_row := league_update(v_league, v_ver, jsonb_build_object('name','x'));
        v_fail:=v_fail+1; RAISE WARNING 'FAIL edited a CLOSED league';
    EXCEPTION WHEN others THEN
        IF SQLERRM='LEAGUE_TERMINAL' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS closed league cannot be edited (L1 guard holds)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    ---------------------------------------------------------------- authz
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
    BEGIN
        v_row := league_pause(v_league, v_ver);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL non-organizer paused';
    EXCEPTION WHEN others THEN
        IF SQLERRM='NOT_ORGANIZER' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS pause NOT_ORGANIZER';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL got %', SQLERRM; END IF;
    END;

    RAISE NOTICE '================ PASS=% FAIL=%', v_pass, v_fail;
    IF v_fail > 0 THEN RAISE EXCEPTION '% FAILURES', v_fail; END IF;

    DELETE FROM leagues_tournaments_audit WHERE entity_id IN (
        SELECT id FROM sessions WHERE season_id=v_season.id
        UNION ALL SELECT v_season.id UNION ALL SELECT v_league);
    DELETE FROM leagues WHERE id=v_league;
END $$;
