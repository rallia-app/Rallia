-- L4: paid season enrollment, fee math, and the three traps.
DO $$
DECLARE
    v_org uuid; v_p1 uuid; v_p2 uuid; v_sport uuid;
    v_league leagues; v_season seasons; v_q record; v_begin record;
    v_member season_members; v_pay lt_registration_payment;
    v_pass integer := 0; v_fail integer := 0;
    v_n integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    SELECT ps.player_id INTO v_org FROM player_sport ps WHERE ps.sport_id=v_sport LIMIT 1;
    SELECT ps.player_id INTO v_p1 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id<>v_org LIMIT 1;
    SELECT ps.player_id INTO v_p2 FROM player_sport ps WHERE ps.sport_id=v_sport AND ps.player_id NOT IN (v_org,v_p1) LIMIT 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    v_league := league_create(p_name=>'L4 Paid', p_sport_id=>v_sport, p_visibility=>'public', p_join_mode=>'open');

    -- Members join the league (free).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    PERFORM league_join(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    PERFORM league_join(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    -- $40 season, player pays.
    v_season := season_create(v_league.id, 'Winter Paid', current_date, current_date+90,
                              NULL, 4000, 'player_pays', 'hold_until_event_end', 'full', NULL, NULL);
    IF v_season.entry_fee_cents = 4000 AND v_season.fee_payer='player_pays' THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS season_create stores fee settings';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL fee settings: %', to_jsonb(v_season); END IF;

    -------------------------------------------------- TRAP 2: payout gate
    BEGIN
        PERFORM season_open(v_season.id, v_season.version);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL opened a paid season with no Stripe onboarding';
    EXCEPTION WHEN others THEN
        IF SQLERRM='PAYOUTS_SETUP_REQUIRED' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [trap] paid season blocked: PAYOUTS_SETUP_REQUIRED';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL payout gate got %', SQLERRM; END IF;
    END;

    -- Onboard the organizer.
    INSERT INTO player_stripe_account (player_id, stripe_account_id, charges_enabled)
    VALUES (v_org, 'acct_test_l4', true)
    ON CONFLICT (player_id) DO UPDATE SET charges_enabled=true, stripe_account_id='acct_test_l4';

    v_season := season_open(v_season.id, v_season.version);
    IF v_season.status='open' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS paid season opens once onboarded';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL open'; END IF;

    -------------------------------------------------- TRAP 1: no free ranking rows
    SELECT count(*) INTO v_n FROM season_rankings WHERE season_id=v_season.id;
    IF v_n = 0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [trap] paid season_open seeded 0 ranking rows (nobody paid yet)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL paid season seeded % unpaid ranking rows', v_n; END IF;

    -------------------------------------------------- fee quote math
    SELECT * INTO v_q FROM season_fee_quote(v_season.id);
    -- 5% of 4000 = 200, +100 flat = 300, cap 2000 -> 300. tax = round(300*14975/100000)=45
    -- Rate/flat come from platform_service_fee_default; update here on any fee change.
    IF v_q.entry_cents=4000 AND v_q.service_fee_cents=300 AND v_q.fee_tax_cents=45
       AND v_q.total_cents=4345 AND v_q.organizer_receives_cents=4000 THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS fee quote: entry=4000 fee=300 tax=45 total=4345 organizer=4000';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL quote: %', to_jsonb(v_q); END IF;

    -------------------------------------------------- TRAP 1b: season_enroll must not bypass payment
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    BEGIN
        PERFORM season_enroll(v_season.id);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL season_enroll bypassed payment';
    EXCEPTION WHEN others THEN
        IF SQLERRM='PAYMENT_REQUIRED' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [trap] season_enroll blocked: PAYMENT_REQUIRED';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL enroll got %', SQLERRM; END IF;
    END;

    -------------------------------------------------- begin paid enrollment
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_season.id);
    IF v_begin.amount_charged_cents=4345 AND v_begin.organizer_amount_cents=4000
       AND v_begin.organizer_onboarded AND v_begin.organizer_stripe_account_id='acct_test_l4' THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS begin_paid_enrollment: charge=4345 organizer=4000 onboarded';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL begin: %', to_jsonb(v_begin); END IF;

    SELECT * INTO v_member FROM season_members WHERE id=v_begin.season_user_id;
    IF v_member.status='payment_pending' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS slot claimed at payment_pending';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL member status %', v_member.status; END IF;

    SELECT * INTO v_pay FROM lt_registration_payment WHERE id=v_begin.payment_id;
    IF v_pay.season_id=v_season.id AND v_pay.season_user_id=v_member.id
       AND v_pay.tournament_registration_id IS NULL AND v_pay.status='pending'
       AND v_pay.fee_tax_cents=45 AND v_pay.expires_at > now() THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS ledger row is season-shaped (XOR satisfied, 15min TTL)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL ledger: %', to_jsonb(v_pay); END IF;

    -- Still no ranking row while merely payment_pending.
    SELECT count(*) INTO v_n FROM season_rankings WHERE season_id=v_season.id;
    IF v_n=0 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS payment_pending grants no ranking row';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL % ranking rows while pending', v_n; END IF;

    -------------------------------------------------- webhook success path
    -- Order matters and mirrors lt-payment-webhook: the ledger is marked
    -- succeeded BEFORE the member flips, which is what the payment gate checks.
    UPDATE lt_registration_payment SET status='succeeded' WHERE id=v_pay.id;
    UPDATE season_members SET status='enrolled' WHERE id=v_member.id;

    SELECT count(*) INTO v_n FROM season_rankings WHERE season_id=v_season.id AND user_id=v_p1;
    IF v_n=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS enrolled -> ranking row seeded by trigger';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL ranking rows for payer: %', v_n; END IF;

    -------------------------------------------------- TRAP 1d: paid withdraw must go through the refund path
    -- season_withdraw had no fee/ledger awareness, so a paid player could
    -- withdraw for free. That also closed the refund door for good:
    -- season_request_refund only accepts enrolled/pending, so every later
    -- attempt raises OPTIMISTIC_LOCK_CONFLICT while the succeeded ledger row is
    -- still released to the organizer at season close.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    BEGIN
        PERFORM season_withdraw(v_season.id);
        v_fail:=v_fail+1; RAISE WARNING 'FAIL *** paid enrolment withdrew for free, refund now unreachable ***';
    EXCEPTION WHEN others THEN
        IF SQLERRM='REFUND_REQUIRED' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [trap] paid withdraw blocked: REFUND_REQUIRED';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL paid withdraw got %', SQLERRM; END IF;
    END;
    SELECT * INTO v_member FROM season_members WHERE id=v_member.id;
    IF v_member.status='enrolled' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS blocked withdraw left the payer enrolled';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL payer left at % after blocked withdraw', v_member.status; END IF;

    -------------------------------------------------- TRAP 1e: payment history survives a league delete
    -- leagues -> seasons -> season_members -> lt_registration_payment was
    -- CASCADE the whole way, so deleting a league erased the Stripe intent and
    -- charge ids, refund state and fee snapshot, and dropped the season out of
    -- both settlement candidate sets. Ledger FKs are RESTRICT now.
    BEGIN
        DELETE FROM leagues WHERE id=v_league.id;
        v_fail:=v_fail+1; RAISE WARNING 'FAIL *** league delete wiped live payment history ***';
    EXCEPTION WHEN foreign_key_violation THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS [trap] league delete refused while payment history exists';
    END;

    -------------------------------------------------- TRAP 1c: recalc must not re-add unpaid members
    PERFORM recalc_season_ranking(v_season.id);
    SELECT count(*) INTO v_n FROM season_rankings WHERE season_id=v_season.id;
    IF v_n=1 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [trap] recalc kept roster at 1 (did not re-add unpaid league members)';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL recalc roster = % (unpaid members leaked in)', v_n; END IF;

    -------------------------------------------------- REGRESSION: the UPDATE-path bypass
    -- A player begins a paid checkout (row -> payment_pending), abandons Stripe,
    -- then calls the FREE enroll path. season_enroll re-uses the existing row via
    -- UPDATE, so a BEFORE INSERT-only gate let this through: enrolled + ranked,
    -- ledger still 'pending'. The gate keys off the resulting status for UPDATE
    -- too, and requires a succeeded payment.
    DECLARE v_bp record; v_bm season_members; BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
        SELECT * INTO v_bp FROM season_begin_paid_enrollment(v_season.id);
        BEGIN
            PERFORM season_enroll(v_season.id);
            v_fail:=v_fail+1; RAISE WARNING 'FAIL *** PAYMENT BYPASS: abandoned checkout + season_enroll = free entry ***';
        EXCEPTION WHEN others THEN
            IF SQLERRM='PAYMENT_REQUIRED' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS [regression] abandoned-checkout + season_enroll cannot bypass payment';
            ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL bypass probe got %', SQLERRM; END IF;
        END;
        SELECT * INTO v_bm FROM season_members WHERE id=v_bp.season_user_id;
        IF v_bm.status='payment_pending' THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS bypass attempt left the row at payment_pending';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL row moved to % after bypass attempt', v_bm.status; END IF;
        -- clean up so the reaper test below starts fresh
        DELETE FROM lt_registration_payment WHERE id=v_bp.payment_id;
        DELETE FROM season_members WHERE id=v_bp.season_user_id;
    END;

    -------------------------------------------------- TRAP 3: reaper frees abandoned slots
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_season.id);
    UPDATE lt_registration_payment SET expires_at = now() - interval '1 minute' WHERE id=v_begin.payment_id;
    PERFORM lt_expire_stale_registration_payments();
    SELECT * INTO v_member FROM season_members WHERE id=v_begin.season_user_id;
    SELECT status INTO v_pay.status FROM lt_registration_payment WHERE id=v_begin.payment_id;
    IF v_member.status='withdrawn' AND v_pay.status='cancelled' THEN
        v_pass:=v_pass+1; RAISE NOTICE 'PASS [trap] reaper freed the abandoned season slot';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL reaper: member=% pay=%', v_member.status, v_pay.status; END IF;

    -------------------------------------------------- free season regression
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    DECLARE v_free seasons; BEGIN
        v_free := season_create(v_league.id, 'Free Season', current_date, current_date+90);
        v_free := season_open(v_free.id, v_free.version);
        SELECT count(*) INTO v_n FROM season_rankings WHERE season_id=v_free.id;
        -- league_create inserts the organizer as an active member, so: org + p1 + p2.
        IF v_n = 3 THEN v_pass:=v_pass+1; RAISE NOTICE 'PASS free season still seeds all 3 active league members, unchanged';
        ELSE v_fail:=v_fail+1; RAISE WARNING 'FAIL free season seeded % (expected 3)', v_n; END IF;

        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
        PERFORM season_enroll(v_free.id);
        v_pass:=v_pass+1; RAISE NOTICE 'PASS free season_enroll still works (no payment gate)';
    END;

    RAISE NOTICE '================ PASS=% FAIL=%', v_pass, v_fail;
    IF v_fail > 0 THEN RAISE EXCEPTION '% FAILURES', v_fail; END IF;

    -- The ledger FKs are RESTRICT (20260721140000), so fixture teardown has to
    -- drop payment history explicitly. That refusal is the point of TRAP 1e.
    DELETE FROM lt_registration_payment WHERE season_id IN (SELECT id FROM seasons WHERE league_id=v_league.id);
    DELETE FROM leagues WHERE id=v_league.id;
    DELETE FROM player_stripe_account WHERE player_id=v_org;
END $$;
