-- Organizer-side paid-season money safety: season_remove_member must not
-- strand a paid player's money, and season_refund_member is the refund+remove
-- path that makes REFUND_REQUIRED reachable. (20260721150000)
DO $$
DECLARE
    v_org uuid; v_p1 uuid; v_p2 uuid; v_sport uuid;
    v_league leagues; v_season seasons;
    v_begin record; v_member season_members; v_plan record;
    v_pass integer := 0; v_fail integer := 0;
    v_status text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    SELECT ps.player_id INTO v_org FROM player_sport ps WHERE ps.sport_id=v_sport LIMIT 1;
    SELECT ps.player_id INTO v_p1 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id<>v_org LIMIT 1;
    SELECT ps.player_id INTO v_p2 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id NOT IN (v_org,v_p1) LIMIT 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    v_league := league_create(p_name=>'OrgRefund', p_sport_id=>v_sport, p_visibility=>'public', p_join_mode=>'open');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    PERFORM league_join(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    PERFORM league_join(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed)
    VALUES (v_org, 'acct_test_or', true)
    ON CONFLICT (player_id) DO UPDATE SET onboarding_completed=true, stripe_account_id='acct_test_or';

    -- $40 season, full refund policy, player pays.
    v_season := season_create(v_league.id, 'OR Season', current_date, current_date+90,
                              NULL, 4000, 'player_pays', 'hold_until_event_end', 'full', NULL, NULL);
    v_season := season_open(v_season.id, v_season.version);

    -- p1 pays and is enrolled (webhook order: ledger succeeded, then member).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_season.id);
    UPDATE lt_registration_payment SET status='succeeded', stripe_payment_intent_id='pi_or1', stripe_charge_id='ch_or1'
     WHERE id=v_begin.payment_id;
    UPDATE season_members SET status='enrolled' WHERE id=v_begin.season_user_id;

    -------------------------------------------------- guard: remove strands nothing
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT version INTO v_status FROM season_members WHERE id=v_begin.season_user_id;
    BEGIN
        PERFORM season_remove_member(v_begin.season_user_id, (SELECT version FROM season_members WHERE id=v_begin.season_user_id));
        v_fail:=v_fail+1; RAISE WARNING 'FAIL *** organizer removed a paid player for free ***';
    EXCEPTION WHEN others THEN
        IF SQLERRM='REFUND_REQUIRED' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [guard] remove of a live-paid member blocked: REFUND_REQUIRED';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL remove guard got %', SQLERRM; END IF;
    END;
    SELECT status INTO v_status FROM season_members WHERE id=v_begin.season_user_id;
    IF v_status='enrolled' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS blocked remove left the payer enrolled';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL payer left at % after blocked remove', v_status; END IF;

    -------------------------------------------------- authz: non-organizer can't refund
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    BEGIN
        PERFORM season_refund_member(v_begin.season_user_id, (SELECT version FROM season_members WHERE id=v_begin.season_user_id));
        v_fail:=v_fail+1; RAISE WARNING 'FAIL *** non-organizer refunded another member ***';
    EXCEPTION WHEN others THEN
        IF SQLERRM='NOT_ORGANIZER' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [authz] season_refund_member rejects a non-organizer';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL authz got %', SQLERRM; END IF;
    END;

    -------------------------------------------------- organizer refund returns the plan
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_plan FROM season_refund_member(
        v_begin.season_user_id, (SELECT version FROM season_members WHERE id=v_begin.season_user_id));
    IF v_plan.payment_id=v_begin.payment_id
       AND v_plan.refundable_entry_cents=4000
       AND v_plan.stripe_payment_intent_id='pi_or1'
       AND v_plan.entry_cents=4000 THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS organizer refund returns a full-refund plan (4000)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL refund plan: %', to_jsonb(v_plan); END IF;

    SELECT status INTO v_status FROM season_members WHERE id=v_begin.season_user_id;
    IF v_status='withdrawn' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS refunded member is off the roster (withdrawn)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL member at % after refund', v_status; END IF;

    -------------------------------------------------- double-refund guard
    -- Member is now withdrawn; the status filter in the UPDATE is the guard, so
    -- a second refund at the current version still cannot double-pay.
    BEGIN
        PERFORM season_refund_member(
            v_begin.season_user_id, (SELECT version FROM season_members WHERE id=v_begin.season_user_id));
        v_fail:=v_fail+1; RAISE WARNING 'FAIL *** double refund succeeded ***';
    EXCEPTION WHEN others THEN
        IF SQLERRM IN ('OPTIMISTIC_LOCK_CONFLICT','NO_PAID_ENROLLMENT') THEN
            v_pass:=v_pass+1; RAISE NOTICE 'PASS [guard] second refund cannot double-pay (%))', SQLERRM;
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL double-refund got %', SQLERRM; END IF;
    END;

    -------------------------------------------------- released row stays removable
    -- p2 pays, is enrolled, then the payment is released at settlement.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_season.id);
    UPDATE lt_registration_payment
       SET status='succeeded', stripe_payment_intent_id='pi_or2', stripe_charge_id='ch_or2',
           stripe_payout_id='po_or2', released_at=now()
     WHERE id=v_begin.payment_id;
    UPDATE season_members SET status='enrolled' WHERE id=v_begin.season_user_id;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_member FROM season_remove_member(
        v_begin.season_user_id, (SELECT version FROM season_members WHERE id=v_begin.season_user_id));
    IF v_member.status='withdrawn' THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS settled (released) member is removable, no live money to strand';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL released remove: %', v_member.status; END IF;

    -------------------------------------------------- free member removable
    DECLARE v_free seasons; v_fm season_members; BEGIN
        v_free := season_create(v_league.id, 'Free', current_date, current_date+30);
        v_free := season_open(v_free.id, v_free.version);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
        PERFORM season_enroll(v_free.id);
        SELECT * INTO v_fm FROM season_members WHERE season_id=v_free.id AND user_id=v_p1;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
        SELECT * INTO v_fm FROM season_remove_member(v_fm.id, v_fm.version);
        IF v_fm.status='withdrawn' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS free-season member still removable (no guard)';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL free remove: %', v_fm.status; END IF;
    END;

    RAISE NOTICE '================ PASS=% FAIL=%', v_pass, v_fail;
    IF v_fail > 0 THEN RAISE EXCEPTION '% FAILURES', v_fail; END IF;

    -- Ledger FKs are RESTRICT (20260721140000): drop payment history first.
    DELETE FROM lt_registration_payment WHERE season_id IN (SELECT id FROM seasons WHERE league_id=v_league.id);
    DELETE FROM leagues WHERE id=v_league.id;
    DELETE FROM player_stripe_account WHERE player_id=v_org;
END $$;
