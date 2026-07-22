-- Organizer removal of a paid season member is an involuntary exit that the
-- settle cron auto-refunds, mirroring the tournament design (20260721130300).
-- Removal marks 'disqualified'; that entry is a cancel-refund candidate (money
-- goes back) and is excluded from the release candidates (money never paid to
-- the organizer). An already-settled entry is not clawed back. (20260721160100)
DO $$
DECLARE
    v_org uuid; v_p1 uuid; v_p2 uuid; v_sport uuid;
    v_league leagues; v_season seasons; v_closed seasons;
    v_begin record; v_member season_members;
    v_pass integer := 0; v_fail integer := 0; v_n integer; v_status text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    SELECT ps.player_id INTO v_org FROM player_sport ps WHERE ps.sport_id=v_sport LIMIT 1;
    SELECT ps.player_id INTO v_p1 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id<>v_org LIMIT 1;
    SELECT ps.player_id INTO v_p2 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id NOT IN (v_org,v_p1) LIMIT 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    v_league := league_create(p_name=>'OrgRemove', p_sport_id=>v_sport, p_visibility=>'public', p_join_mode=>'open');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    PERFORM league_join(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    PERFORM league_join(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed)
    VALUES (v_org, 'acct_test_rm', true)
    ON CONFLICT (player_id) DO UPDATE SET onboarding_completed=true, stripe_account_id='acct_test_rm';

    -- $40 full-refund paid season, open.
    v_season := season_create(v_league.id, 'RM Season', current_date, current_date+90,
                              NULL, 4000, 'player_pays', 'hold_until_event_end', 'full', NULL, NULL);
    v_season := season_open(v_season.id, v_season.version);

    -- p1 pays and is enrolled (webhook order: ledger succeeded, then member).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_season.id);
    UPDATE lt_registration_payment SET status='succeeded', stripe_payment_intent_id='pi_rm1', stripe_charge_id='ch_rm1'
     WHERE id=v_begin.payment_id;
    UPDATE season_members SET status='enrolled' WHERE id=v_begin.season_user_id;

    -------------------------------------------------- authz
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    BEGIN
        PERFORM season_remove_member(v_begin.season_user_id, (SELECT version FROM season_members WHERE id=v_begin.season_user_id));
        v_fail:=v_fail+1; RAISE WARNING 'FAIL *** non-organizer removed a member ***';
    EXCEPTION WHEN others THEN
        IF SQLERRM='NOT_ORGANIZER' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [authz] season_remove_member rejects a non-organizer';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL authz got %', SQLERRM; END IF;
    END;

    -------------------------------------------------- removal marks disqualified
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_member FROM season_remove_member(
        v_begin.season_user_id, (SELECT version FROM season_members WHERE id=v_begin.season_user_id));
    IF v_member.status='disqualified' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS organizer removal marks the paid member disqualified';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL member at % after removal', v_member.status; END IF;

    -- Off the visible roster and the ranking roster (both key on 'enrolled').
    SELECT count(*) INTO v_n FROM season_ranking_roster(v_season.id) WHERE user_id=v_p1;
    IF v_n=0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS removed member is off the ranking roster';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL removed member still ranked (%)', v_n; END IF;

    -------------------------------------------------- removal queues a refund
    SELECT count(*) INTO v_n FROM lt_cancel_refund_candidates() WHERE payment_id=v_begin.payment_id;
    IF v_n=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS removed member''s entry is queued for refund (cancel candidate)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL removed entry not a refund candidate (%)', v_n; END IF;

    -------------------------------------------------- free member removable, no refund
    DECLARE v_free seasons; v_fm season_members; BEGIN
        v_free := season_create(v_league.id, 'Free', current_date, current_date+30);
        v_free := season_open(v_free.id, v_free.version);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
        PERFORM season_enroll(v_free.id);
        SELECT * INTO v_fm FROM season_members WHERE season_id=v_free.id AND user_id=v_p2;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
        SELECT * INTO v_fm FROM season_remove_member(v_fm.id, v_fm.version);
        IF v_fm.status='disqualified' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS free member removable (disqualified, nothing to refund)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL free remove: %', v_fm.status; END IF;
    END;

    -------------------------------------------------- release exclusion + no clawback
    -- A closed, settle-eligible season: a normal member is a release candidate,
    -- a removed one is not (its entry refunds instead).
    v_closed := season_create(v_league.id, 'Closed', current_date, current_date+90,
                              NULL, 4000, 'player_pays', 'hold_until_event_end', 'full', NULL, NULL);
    v_closed := season_open(v_closed.id, v_closed.version);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_closed.id);
    UPDATE lt_registration_payment SET status='succeeded', stripe_payment_intent_id='pi_rm2', stripe_charge_id='ch_rm2'
     WHERE id=v_begin.payment_id;
    UPDATE season_members SET status='enrolled' WHERE id=v_begin.season_user_id;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    v_closed := season_close(v_closed.id, v_closed.version);
    UPDATE seasons SET closed_at = now() - interval '48 hours' WHERE id=v_closed.id;

    SELECT count(*) INTO v_n FROM lt_release_candidates() WHERE payment_id=v_begin.payment_id;
    IF v_n=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS enrolled member in a settled closed season is a release candidate';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL expected release candidate, got %', v_n; END IF;

    -- Remove after close: drops out of release, into refund (payout not yet gone out).
    SELECT * INTO v_member FROM season_remove_member(
        v_begin.season_user_id, (SELECT version FROM season_members WHERE id=v_begin.season_user_id));
    SELECT count(*) INTO v_n FROM lt_release_candidates() WHERE payment_id=v_begin.payment_id;
    IF v_n=0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS removed member excluded from release (won''t be paid to organizer)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL removed member still a release candidate (%)', v_n; END IF;
    SELECT count(*) INTO v_n FROM lt_cancel_refund_candidates() WHERE payment_id=v_begin.payment_id;
    IF v_n=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS removed-after-close member is refunded instead';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL removed-after-close not refunded (%)', v_n; END IF;

    -- Already settled (payout_id set): removal must not claw it back.
    UPDATE lt_registration_payment SET stripe_payout_id='po_rm2' WHERE id=v_begin.payment_id;
    SELECT count(*) INTO v_n FROM lt_cancel_refund_candidates() WHERE payment_id=v_begin.payment_id;
    IF v_n=0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS a settled (paid-out) entry is not clawed back on removal';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL settled entry became a refund candidate (%)', v_n; END IF;

    RAISE NOTICE '================ PASS=% FAIL=%', v_pass, v_fail;
    IF v_fail > 0 THEN RAISE EXCEPTION '% FAILURES', v_fail; END IF;

    -- Ledger FKs are RESTRICT (20260721140000): drop payment history first.
    DELETE FROM lt_registration_payment WHERE season_id IN (SELECT id FROM seasons WHERE league_id=v_league.id);
    DELETE FROM leagues WHERE id=v_league.id;
    DELETE FROM player_stripe_account WHERE player_id=v_org;
END $$;
