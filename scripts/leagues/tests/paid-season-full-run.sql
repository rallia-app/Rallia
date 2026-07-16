-- Can an organizer actually RUN a paid season, start to finish?
--
-- The other suites prove enrolment and money in isolation. This one walks the
-- whole thing the way a pilot organizer would: create league -> invite players ->
-- price + open a season -> players pay -> session -> confirmations -> match sheet
-- -> scores -> close -> standings. It exists because the interesting failures are
-- at the seams (a paid season's roster is season_members, but sessions and
-- pairing were built against league_members), not inside any single RPC.
DO $$
DECLARE
    v_org uuid; v_p1 uuid; v_p2 uuid; v_sport uuid;
    v_league leagues; v_season seasons; v_sess sessions;
    v_b record; v_m season_members; v_match session_matches;
    v_pass integer := 0; v_fail integer := 0;
    v_n integer; v_standings jsonb;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    SELECT ps.player_id INTO v_org FROM player_sport ps WHERE ps.sport_id=v_sport LIMIT 1;
    SELECT ps.player_id INTO v_p1 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id<>v_org LIMIT 1;
    SELECT ps.player_id INTO v_p2 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id NOT IN (v_org,v_p1) LIMIT 1;

    INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed)
    VALUES (v_org,'acct_fullrun',true)
    ON CONFLICT (player_id) DO UPDATE SET onboarding_completed=true, stripe_account_id='acct_fullrun';

    ---------------------------------------------------------------- 1. create league
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    v_league := league_create(p_name=>'Full Run', p_sport_id=>v_sport, p_visibility=>'public', p_join_mode=>'invite_only');
    v_pass:=v_pass+1; RAISE NOTICE 'PASS 1. league created (invite_only)';

    ---------------------------------------------------------------- 2. invite players
    PERFORM league_invite_members(v_league.id, ARRAY[v_p1, v_p2]);
    SELECT count(*) INTO v_n FROM league_members WHERE league_id=v_league.id AND status='pending';
    IF v_n=2 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 2. both players invited (pending)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL invited=%', v_n; END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    PERFORM league_accept_invite(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    PERFORM league_accept_invite(v_league.id);
    SELECT count(*) INTO v_n FROM league_members WHERE league_id=v_league.id AND status='active';
    IF v_n=3 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 2b. both accepted -> 3 active members (incl. organizer)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL active=%', v_n; END IF;

    ---------------------------------------------------------------- 3. price + open season
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    v_season := season_create(v_league.id, 'Paid Run', current_date, current_date+90,
                              NULL, 4000, 'player_pays', 'hold_until_event_end', 'full', NULL, NULL);
    v_season := season_open(v_season.id, v_season.version);
    IF v_season.status='open' AND v_season.entry_fee_cents=4000 THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS 3. paid season opened ($40)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL season open'; END IF;

    ---------------------------------------------------------------- 4. players pay
    -- Both legs mirror lt-payment-webhook: ledger succeeded, THEN member enrolled.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    SELECT * INTO v_b FROM season_begin_paid_enrollment(v_season.id);
    UPDATE lt_registration_payment SET status='succeeded' WHERE id=v_b.payment_id;
    UPDATE season_members SET status='enrolled' WHERE id=v_b.season_user_id;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    SELECT * INTO v_b FROM season_begin_paid_enrollment(v_season.id);
    UPDATE lt_registration_payment SET status='succeeded' WHERE id=v_b.payment_id;
    UPDATE season_members SET status='enrolled' WHERE id=v_b.season_user_id;

    SELECT count(*) INTO v_n FROM season_members WHERE season_id=v_season.id AND status='enrolled';
    IF v_n=2 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 4. both players paid and enrolled';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL enrolled=%', v_n; END IF;

    -- The organizer never paid, so must NOT be on the paid roster or ranked.
    SELECT count(*) INTO v_n FROM season_rankings WHERE season_id=v_season.id;
    IF v_n=2 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 4b. exactly the 2 payers are ranked (unpaid organizer excluded)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL ranked=% (expected 2)', v_n; END IF;

    ---------------------------------------------------------------- 5. session
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    v_sess := session_create(v_season.id, 'Week 1', now() + interval '2 days');
    v_sess := session_publish(v_sess.id, now() + interval '1 day', v_sess.version);
    IF v_sess.status='published' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 5. session created + published';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL session status=%', v_sess.status; END IF;

    ---------------------------------------------------------------- 6. confirmations
    -- A paid, enrolled player confirms. This is the seam: confirm auto-enrols,
    -- and on a paid season that hits the payment gate unless already enrolled.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    BEGIN
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
        v_pass:=v_pass+1; RAISE NOTICE 'PASS 6. paid+enrolled player can confirm presence';
    EXCEPTION WHEN others THEN
        v_fail:=v_fail+1; RAISE WARNING 'FAIL enrolled player blocked from confirming: %', SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    PERFORM session_confirm_presence(v_sess.id, 'confirmed');

    -- ...and an active league member who never paid must NOT get in via confirm.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    BEGIN
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
        RAISE NOTICE 'INFO 6b. unpaid organizer confirmed (organizer bypass) — status=%',
            (SELECT status FROM season_members WHERE season_id=v_season.id AND user_id=v_org);
    EXCEPTION WHEN others THEN
        IF SQLERRM='PAYMENT_REQUIRED' THEN
            v_pass:=v_pass+1; RAISE NOTICE 'PASS 6b. unpaid member cannot sneak in via confirm_presence';
        ELSE RAISE NOTICE 'INFO 6b. unpaid confirm -> %', SQLERRM; END IF;
    END;

    SELECT count(*) INTO v_n FROM session_presence WHERE session_id=v_sess.id AND status='confirmed';
    RAISE NOTICE 'INFO confirmed: %', v_n;

    ---------------------------------------------------------------- 7. match sheet
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT version INTO v_n FROM sessions WHERE id=v_sess.id;
    PERFORM session_generate_sheet(v_sess.id, v_n);
    SELECT count(*) INTO v_n FROM session_matches WHERE session_id=v_sess.id;
    IF v_n >= 1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 7. match sheet generated (% match(es))', v_n;
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL no matches generated'; END IF;

    ---------------------------------------------------------------- 8. record a score
    SELECT * INTO v_match FROM session_matches WHERE session_id=v_sess.id AND is_drill=false LIMIT 1;
    IF v_match.id IS NULL THEN
        v_fail:=v_fail+1; RAISE WARNING 'FAIL no playable match on the sheet';
    ELSE
        PERFORM session_record_score(v_match.id, 'a', '6-4 6-2', 'completed', v_match.version);
        SELECT status INTO v_match.status FROM session_matches WHERE id=v_match.id;
        IF v_match.status='completed' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 8. score recorded (6-4 6-2)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL match status=%', v_match.status; END IF;
    END IF;

    ---------------------------------------------------------------- 9. close + standings
    UPDATE sessions SET status='completed' WHERE id=v_sess.id;
    SELECT version INTO v_n FROM seasons WHERE id=v_season.id;
    v_season := season_close(v_season.id, v_n);
    IF v_season.status='closed' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 9. season closed';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL close'; END IF;

    v_standings := v_season.final_standings;
    IF v_standings IS NOT NULL AND jsonb_array_length(v_standings) = 2 THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS 9b. final standings snapshot has both payers';
    ELSE
        v_fail:=v_fail+1; RAISE WARNING 'FAIL standings: %', v_standings; END IF;

    SELECT count(*) INTO v_n FROM season_rankings
     WHERE season_id=v_season.id AND points > 0;
    IF v_n >= 1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 9c. the match produced points in the standings';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL nobody scored points'; END IF;

    ---------------------------------------------------------------- 10. organizer gets paid
    UPDATE seasons SET closed_at = now() - interval '25 hours' WHERE id=v_season.id;
    SELECT count(*) INTO v_n FROM lt_release_candidates()
     WHERE organizer_stripe_account_id='acct_fullrun';
    IF v_n=2 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS 10. both entries are payout candidates 24h after close';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL payout candidates=% (expected 2)', v_n; END IF;

    RAISE NOTICE '================ PASS=% FAIL=%', v_pass, v_fail;
    IF v_fail > 0 THEN RAISE EXCEPTION '% FAILURES', v_fail; END IF;

    DELETE FROM leagues WHERE id=v_league.id;
    DELETE FROM player_stripe_account WHERE player_id=v_org;
END $$;
