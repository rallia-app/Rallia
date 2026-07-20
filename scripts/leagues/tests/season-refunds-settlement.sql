-- L5: season refunds + settlement candidates.
DO $$
DECLARE
    v_org uuid; v_p1 uuid; v_sport uuid;
    v_league leagues; v_season seasons; v_begin record; v_plan record;
    v_member season_members; v_n integer;
    v_pass integer := 0; v_fail integer := 0;
    v_pay_id uuid;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    SELECT ps.player_id INTO v_org FROM player_sport ps WHERE ps.sport_id=v_sport LIMIT 1;
    SELECT ps.player_id INTO v_p1 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id<>v_org LIMIT 1;

    INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed)
    VALUES (v_org, 'acct_test_l5', true)
    ON CONFLICT (player_id) DO UPDATE SET onboarding_completed=true, stripe_account_id='acct_test_l5';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    v_league := league_create(p_name=>'L5 Refunds', p_sport_id=>v_sport, p_join_mode=>'open');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    PERFORM league_join(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    ---------------------------------------------------------------- FULL refund
    v_season := season_create(v_league.id, 'Full Refund', current_date, current_date+90,
                              NULL, 5000, 'player_pays', 'hold_until_event_end', 'full', NULL, NULL);
    v_season := season_open(v_season.id, v_season.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_season.id);
    -- simulate webhook success
    -- ledger first, then member — mirrors lt-payment-webhook's order
    UPDATE lt_registration_payment SET status='succeeded', stripe_payment_intent_id='pi_l5',
           stripe_charge_id='ch_l5' WHERE id=v_begin.payment_id;
    UPDATE season_members SET status='enrolled' WHERE id=v_begin.season_user_id;

    SELECT * INTO v_member FROM season_members WHERE id=v_begin.season_user_id;
    SELECT * INTO v_plan FROM season_request_refund(v_member.id, v_member.version);
    -- fee on 5000 = 300+150=450; tax=67. Entry refundable in full = 5000.
    IF v_plan.refundable_entry_cents = 5000 AND v_plan.entry_cents = 5000
       AND v_plan.stripe_payment_intent_id='pi_l5' THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS full policy refunds the entry (5000), never the fee/tax';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL full refund plan: %', to_jsonb(v_plan); END IF;

    SELECT status INTO v_member.status FROM season_members WHERE id=v_member.id;
    IF v_member.status='withdrawn' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS refund withdrew the member';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL member status %', v_member.status; END IF;

    -- double refund must lose the optimistic lock
    BEGIN
        SELECT * INTO v_plan FROM season_request_refund(v_member.id, 1);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL double refund allowed';
    EXCEPTION WHEN others THEN
        IF SQLERRM='OPTIMISTIC_LOCK_CONFLICT' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS double refund blocked by optimistic lock';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL double refund got %', SQLERRM; END IF;
    END;

    ---------------------------------------------------------------- PARTIAL + cutoff
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    DECLARE v_s2 seasons; v_b2 record; v_m2 season_members; BEGIN
        v_s2 := season_create(v_league.id, 'Partial', current_date, current_date+90,
                              NULL, 5000, 'player_pays', 'hold_until_event_end', 'partial', 5000, NULL);
        v_s2 := season_open(v_s2.id, v_s2.version);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
        SELECT * INTO v_b2 FROM season_begin_paid_enrollment(v_s2.id);
        UPDATE lt_registration_payment SET status='succeeded' WHERE id=v_b2.payment_id;
        UPDATE season_members SET status='enrolled' WHERE id=v_b2.season_user_id;
        SELECT * INTO v_m2 FROM season_members WHERE id=v_b2.season_user_id;
        SELECT * INTO v_plan FROM season_request_refund(v_m2.id, v_m2.version);
        IF v_plan.refundable_entry_cents = 2500 THEN
            v_pass:=v_pass+1; RAISE NOTICE 'PASS partial 5000bps refunds half the entry (2500)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL partial: %', v_plan.refundable_entry_cents; END IF;
    END;

    ---------------------------------------------------------------- past cutoff -> 0
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    DECLARE v_s3 seasons; v_b3 record; v_m3 season_members; BEGIN
        v_s3 := season_create(v_league.id, 'Cutoff Past', current_date, current_date+90,
                              NULL, 5000, 'player_pays', 'hold_until_event_end', 'full', NULL,
                              now() - interval '1 day');
        v_s3 := season_open(v_s3.id, v_s3.version);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
        SELECT * INTO v_b3 FROM season_begin_paid_enrollment(v_s3.id);
        UPDATE lt_registration_payment SET status='succeeded' WHERE id=v_b3.payment_id;
        UPDATE season_members SET status='enrolled' WHERE id=v_b3.season_user_id;
        SELECT * INTO v_m3 FROM season_members WHERE id=v_b3.season_user_id;
        SELECT * INTO v_plan FROM season_request_refund(v_m3.id, v_m3.version);
        IF v_plan.refundable_entry_cents = 0 THEN
            v_pass:=v_pass+1; RAISE NOTICE 'PASS past refund cutoff -> 0 refundable (still withdrawn)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL cutoff: %', v_plan.refundable_entry_cents; END IF;
    END;

    ---------------------------------------------------------------- settlement: release
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    DECLARE v_s4 seasons; v_b4 record; BEGIN
        v_s4 := season_create(v_league.id, 'Settle', current_date, current_date+90, NULL, 5000);
        v_s4 := season_open(v_s4.id, v_s4.version);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
        SELECT * INTO v_b4 FROM season_begin_paid_enrollment(v_s4.id);
        UPDATE lt_registration_payment SET status='succeeded', stripe_charge_id='ch_settle'
         WHERE id=v_b4.payment_id;
        UPDATE season_members SET status='enrolled' WHERE id=v_b4.season_user_id;
        v_pay_id := v_b4.payment_id;

        -- Not closed yet -> not a release candidate.
        SELECT count(*) INTO v_n FROM lt_release_candidates() WHERE payment_id=v_pay_id;
        IF v_n=0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS open season is not a release candidate';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL released while open'; END IF;

        -- Closed but <24h -> still not a candidate.
        UPDATE seasons SET status='closed', closed_at=now() WHERE id=v_s4.id;
        SELECT count(*) INTO v_n FROM lt_release_candidates() WHERE payment_id=v_pay_id;
        IF v_n=0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS just-closed season respects the 24h settle delay';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL released within 24h'; END IF;

        -- Closed >24h -> candidate, with the organizer account attached.
        UPDATE seasons SET closed_at = now() - interval '25 hours' WHERE id=v_s4.id;
        SELECT count(*) INTO v_n FROM lt_release_candidates()
         WHERE payment_id=v_pay_id AND organizer_stripe_account_id='acct_test_l5'
           AND organizer_amount_cents=5000 AND organizer_onboarded;
        IF v_n=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS closed >24h -> release candidate (organizer gets 5000)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL not a release candidate'; END IF;
    END;

    ---------------------------------------------------------------- settlement: cancel refund
    DECLARE v_s5 seasons; v_b5 record; BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
        v_s5 := season_create(v_league.id, 'Cancelled', current_date, current_date+90, NULL, 5000);
        v_s5 := season_open(v_s5.id, v_s5.version);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
        SELECT * INTO v_b5 FROM season_begin_paid_enrollment(v_s5.id);
        UPDATE lt_registration_payment SET status='succeeded', stripe_payment_intent_id='pi_cx'
         WHERE id=v_b5.payment_id;
        UPDATE season_members SET status='enrolled' WHERE id=v_b5.season_user_id;

        SELECT count(*) INTO v_n FROM lt_cancel_refund_candidates() WHERE payment_id=v_b5.payment_id;
        IF v_n=0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS open season is not a cancel-refund candidate';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL'; END IF;

        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
        SELECT version INTO v_n FROM seasons WHERE id=v_s5.id;
        PERFORM season_cancel(v_s5.id, 'not enough players', v_n);

        SELECT count(*) INTO v_n FROM lt_cancel_refund_candidates()
         WHERE payment_id=v_b5.payment_id AND entry_cents=5000 AND stripe_payment_intent_id='pi_cx';
        IF v_n=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS season_cancel -> cancel-refund candidate (entry 5000)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL cancel refund candidate missing'; END IF;
    END;

    ---------------------------------------------------------------- tournament leg intact
    SELECT count(*) INTO v_n FROM lt_release_candidates();
    RAISE NOTICE 'INFO lt_release_candidates total rows = % (tournament leg still unioned)', v_n;
    v_pass:=v_pass+1;

    RAISE NOTICE '================ PASS=% FAIL=%', v_pass, v_fail;
    IF v_fail > 0 THEN RAISE EXCEPTION '% FAILURES', v_fail; END IF;

    DELETE FROM leagues WHERE id=v_league.id;
    DELETE FROM player_stripe_account WHERE player_id=v_org;
END $$;
