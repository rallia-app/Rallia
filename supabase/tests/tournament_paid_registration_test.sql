-- ============================================
-- Tournaments — paid registration: fee quote, payment gate, begin, refund (DB-level)
-- ============================================
-- The paid-registration money model (20260629100000 / 110000 / 110100 / 130000)
-- has zero server-side test coverage — the Jest suite mocks Supabase and the
-- one Maestro flow only reads the fee preview and never submits. This file
-- exercises the plpgsql that actually guards the money:
--   * tournament_fee_quote        — all-in math for player_pays / organizer_absorbs
--   * tournament_open_registration — paid publish gate (PAYOUTS_SETUP_REQUIRED)
--   * tg_..._requires_payment      — a paid event can't be joined for free (PAYMENT_REQUIRED)
--   * tournament_begin_paid_registration — reserves a slot + snapshots the fee,
--     with its guards (NOT_PAID / REG_CLOSED / MODE_UNSUPPORTED / FULL / ALREADY_REGISTERED)
--   * tournament_request_refund    — refundable ENTRY per policy + cutoff (never the fee),
--     ownership + double-refund guards
--
-- Fee model under test: 5% + $1.00, $20 cap, plus 14.975% GST/QST on the fee.
-- For entry $50.00 (5000c):
--   service fee = round(5000 * 500 / 10000) + 100 = 250 + 100 = 350c  (< 2000 cap)
--   fee tax     = round(350 * 14975 / 100000)     = 52c
--   player_pays:       player charged 5402c (entry+fee+tax), organizer receives 5000c
--   organizer_absorbs: player charged 5000c,                 organizer receives 4598c (entry-fee-tax)
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed          # seeds 100 players w/ sports
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_paid_registration_test.sql
--
-- One transaction, ROLLBACK at the end. Auth is simulated via the
-- request.jwt.claims GUC (what auth.uid() reads).
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- Helper: paid DRAFT tournament (fee columns set, NOT yet open, no payouts set up).
-- Each test opens registration and wires organizer payouts as its scenario needs.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_paid_draft(
    p_name       text,
    p_entry      integer                 DEFAULT 5000,
    p_fee_payer  fee_payer_enum          DEFAULT 'player_pays',
    p_refund     refund_policy_kind_enum DEFAULT 'none',
    p_refund_bps integer                 DEFAULT NULL,
    p_cutoff     timestamptz             DEFAULT NULL,
    p_mode       tournament_registration_mode DEFAULT 'open',
    p_max        integer                 DEFAULT 8,
    OUT o_org    uuid,
    OUT o_players uuid[],
    OUT o_tid    uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid;
    v_t     tournaments;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO o_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true ORDER BY player_id LIMIT 10) s;
    ASSERT array_length(o_players, 1) = 10, 'need 10 active tennis players';
    o_org := o_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', o_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => p_name, p_sport_id => v_sport, p_max_participants => p_max::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => p_mode);
    o_tid := v_t.id;

    -- Turn it into a paid event. Direct UPDATE keeps the test independent of the
    -- create RPC's evolving fee-param surface; the RPCs under test read these columns.
    UPDATE tournaments
       SET entry_fee_cents    = p_entry,
           currency           = 'CAD',
           fee_payer          = p_fee_payer,
           refund_policy_kind = p_refund,
           refund_partial_bps = p_refund_bps,
           refund_cutoff_at   = p_cutoff
     WHERE id = o_tid;
END $$;

-- Helper: give the organizer a completed Stripe payout account.
CREATE OR REPLACE FUNCTION pg_temp.setup_payouts(p_org uuid, p_completed boolean DEFAULT true)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed)
    VALUES (p_org, 'acct_test_' || left(p_org::text, 8), p_completed)
    ON CONFLICT (player_id) DO UPDATE SET onboarding_completed = EXCLUDED.onboarding_completed;
$$;

-- Helper: simulate a completed payment (what the Stripe webhook does): flip the
-- pending ledger row to succeeded and finalize the registration to 'registered'.
CREATE OR REPLACE FUNCTION pg_temp.mark_paid(p_reg uuid)
RETURNS void LANGUAGE sql AS $$
    UPDATE lt_registration_payment
       SET status = 'succeeded', stripe_payment_intent_id = 'pi_' || left(p_reg::text, 8),
           stripe_charge_id = 'ch_' || left(p_reg::text, 8), updated_at = now()
     WHERE tournament_registration_id = p_reg AND status = 'pending';
    UPDATE tournament_registrations
       SET status = 'registered', version = version + 1, updated_at = now()
     WHERE id = p_reg;
$$;

-- --------------------------------------------------------------------------
-- 1. fee_quote — player_pays vs organizer_absorbs math
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_q record;
BEGIN
    -- player_pays
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Quote — player_pays', 5000, 'player_pays');
    SELECT * INTO v_q FROM tournament_fee_quote(v_tid);
    ASSERT v_q.entry_cents = 5000,              'entry should be 5000, got ' || v_q.entry_cents;
    ASSERT v_q.service_fee_cents = 350,         'fee should be 350, got ' || v_q.service_fee_cents;
    ASSERT v_q.fee_tax_cents = 52,              'fee tax should be 52, got ' || v_q.fee_tax_cents;
    ASSERT v_q.total_cents = 5402,              'player_pays total should be 5402, got ' || v_q.total_cents;
    ASSERT v_q.organizer_receives_cents = 5000, 'organizer should receive 5000, got ' || v_q.organizer_receives_cents;

    -- organizer_absorbs
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Quote — organizer_absorbs', 5000, 'organizer_absorbs');
    SELECT * INTO v_q FROM tournament_fee_quote(v_tid);
    ASSERT v_q.service_fee_cents = 350,         'fee should be 350, got ' || v_q.service_fee_cents;
    ASSERT v_q.fee_tax_cents = 52,              'fee tax should be 52, got ' || v_q.fee_tax_cents;
    ASSERT v_q.total_cents = 5000,              'organizer_absorbs total should be 5000, got ' || v_q.total_cents;
    ASSERT v_q.organizer_receives_cents = 4598, 'organizer should net 4598, got ' || v_q.organizer_receives_cents;

    -- cap boundary: 5% of $500 (2500) + $1 would be 2600, but the fee is capped
    -- at $20 (2000). Tax rides on the capped fee: round(2000 * 14975/100000) = 300.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Quote — cap', 50000, 'player_pays');
    SELECT * INTO v_q FROM tournament_fee_quote(v_tid);
    ASSERT v_q.service_fee_cents = 2000,          'fee should cap at 2000, got ' || v_q.service_fee_cents;
    ASSERT v_q.fee_tax_cents = 300,               'tax on capped fee should be 300, got ' || v_q.fee_tax_cents;
    ASSERT v_q.total_cents = 52300,               'player_pays total should be 52300, got ' || v_q.total_cents;

    -- floor boundary: on a $1 entry the fee+tax (105+16) exceeds the entry, so an
    -- organizer_absorbs organizer nets GREATEST(entry - fee - tax, 0) = 0, never negative.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Quote — floor', 100, 'organizer_absorbs');
    SELECT * INTO v_q FROM tournament_fee_quote(v_tid);
    ASSERT v_q.service_fee_cents = 105,           'fee should be 105, got ' || v_q.service_fee_cents;
    ASSERT v_q.organizer_receives_cents = 0,      'organizer net should floor at 0, got ' || v_q.organizer_receives_cents;
    ASSERT v_q.total_cents = 100,                 'organizer_absorbs total should be the entry (100), got ' || v_q.total_cents;

    RAISE NOTICE 'PASS 1: fee_quote math correct (both modes, cap and floor boundaries)';
END $$;

-- --------------------------------------------------------------------------
-- 2. paid publish gate — open_registration needs organizer payouts set up
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_t tournaments; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Publish Gate');
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;

    -- No Stripe account -> blocked.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    BEGIN PERFORM tournament_open_registration(v_tid, v_t.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYOUTS_SETUP_REQUIRED'); END;
    ASSERT v_ok, 'paid event with no payouts should be blocked from opening';

    -- Account present but onboarding incomplete -> still blocked.
    PERFORM pg_temp.setup_payouts(v_org, false);
    v_ok := false;
    BEGIN PERFORM tournament_open_registration(v_tid, v_t.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYOUTS_SETUP_REQUIRED'); END;
    ASSERT v_ok, 'incomplete onboarding should still block opening';

    -- Onboarding complete -> opens.
    PERFORM pg_temp.setup_payouts(v_org, true);
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_t.version);
    ASSERT v_t.status = 'registration_open', 'should open once payouts are set up, got ' || v_t.status;

    RAISE NOTICE 'PASS 2: paid publish gate (PAYOUTS_SETUP_REQUIRED until onboarded)';
END $$;

-- --------------------------------------------------------------------------
-- 3. a paid event cannot be joined for free -> PAYMENT_REQUIRED
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_t tournaments; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Free-Join Guard');
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);

    -- Player 2 tries the ordinary free register path.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    BEGIN PERFORM tournament_register(v_tid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYMENT_REQUIRED'); END;
    ASSERT v_ok, 'free register on a paid event must be blocked';

    ASSERT NOT EXISTS (
        SELECT 1 FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_players[2]
    ), 'no registration row should have been created';

    RAISE NOTICE 'PASS 3: free join blocked on a paid event (PAYMENT_REQUIRED)';
END $$;

-- --------------------------------------------------------------------------
-- 4. begin_paid_registration — happy path reserves a slot + snapshots the fee
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_t tournaments;
    v_res record; v_reg tournament_registrations; v_pay lt_registration_payment;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Begin — happy', 5000, 'player_pays');
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_res FROM tournament_begin_paid_registration(v_tid);

    -- Returned breakdown.
    ASSERT v_res.amount_charged_cents = 5402,   'charge should be 5402, got ' || v_res.amount_charged_cents;
    ASSERT v_res.organizer_amount_cents = 5000, 'organizer amount should be 5000, got ' || v_res.organizer_amount_cents;
    ASSERT v_res.service_fee_cents = 350,       'fee should be 350, got ' || v_res.service_fee_cents;
    ASSERT v_res.fee_tax_cents = 52,            'fee tax should be 52, got ' || v_res.fee_tax_cents;
    ASSERT v_res.organizer_onboarded = true,    'organizer should be reported onboarded';
    ASSERT v_res.organizer_stripe_account_id IS NOT NULL, 'organizer stripe account id should be returned';

    -- Registration reserved (payment_pending), not yet a real registration.
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_res.registration_id;
    ASSERT v_reg.status = 'payment_pending',    'reservation should be payment_pending, got ' || v_reg.status;
    ASSERT v_reg.user_id = v_players[2],        'reservation should belong to the caller';

    -- Ledger row snapshots the resolved fee and holds the slot with a TTL.
    SELECT * INTO v_pay FROM lt_registration_payment WHERE id = v_res.payment_id;
    ASSERT v_pay.status = 'pending',                 'ledger should be pending, got ' || v_pay.status;
    ASSERT v_pay.entry_cents = 5000,                 'ledger entry should be 5000';
    ASSERT v_pay.service_fee_cents = 350,            'ledger fee should be 350';
    ASSERT v_pay.fee_tax_cents = 52,                 'ledger fee tax should be 52';
    ASSERT v_pay.amount_charged_cents = 5402,        'ledger charge should be 5402';
    ASSERT v_pay.organizer_amount_cents = 5000,      'ledger organizer amount should be 5000';
    ASSERT v_pay.payer_user_id = v_players[2],       'ledger payer should be the caller';
    ASSERT v_pay.organizer_id = v_org,               'ledger organizer should be the organizer';
    ASSERT v_pay.expires_at > now(),                 'ledger reservation should have a future TTL';

    RAISE NOTICE 'PASS 4: begin_paid_registration reserves slot + snapshots fee';
END $$;

-- --------------------------------------------------------------------------
-- 5. begin_paid_registration — guards
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_t tournaments;
    v_res record; v_ok boolean; i integer;
BEGIN
    -- (a) free event -> TOURNAMENT_NOT_PAID
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Begin — free', 0);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);  -- free event needs no payouts
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'TOURNAMENT_NOT_PAID'); END;
    ASSERT v_ok, 'begin on a free event should raise TOURNAMENT_NOT_PAID';

    -- (b) not open (still draft) -> TOURNAMENT_REG_CLOSED
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Begin — draft');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'TOURNAMENT_REG_CLOSED'); END;
    ASSERT v_ok, 'begin before open should raise TOURNAMENT_REG_CLOSED';

    -- (c) approval mode -> PAID_REG_MODE_UNSUPPORTED
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Begin — approval', 5000, 'player_pays', 'none', NULL, NULL, 'approval');
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAID_REG_MODE_UNSUPPORTED'); END;
    ASSERT v_ok, 'paid + approval mode should raise PAID_REG_MODE_UNSUPPORTED';

    -- (d) already confirmed -> ALREADY_REGISTERED
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Begin — already', 5000);
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_res FROM tournament_begin_paid_registration(v_tid);
    PERFORM pg_temp.mark_paid(v_res.registration_id);  -- webhook confirms it
    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'ALREADY_REGISTERED'); END;
    ASSERT v_ok, 'a confirmed registrant beginning again should raise ALREADY_REGISTERED';

    -- (e) capacity full -> TOURNAMENT_FULL (pending payments hold their slots).
    -- Smallest valid bracket is 4 (tournaments_max_participants_check), so fill
    -- all four with pending payments, then the fifth begin is turned away.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Begin — full', 5000, 'player_pays', 'none', NULL, NULL, 'open', 4);
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    FOR i IN 2..5 LOOP  -- four distinct players each reserve a slot
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_begin_paid_registration(v_tid);
    END LOOP;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[6]::text)::text, true);
    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'TOURNAMENT_FULL'); END;
    ASSERT v_ok, 'pending payments should hold slots and cause TOURNAMENT_FULL';

    RAISE NOTICE 'PASS 5: begin guards (NOT_PAID / REG_CLOSED / MODE_UNSUPPORTED / ALREADY_REGISTERED / FULL)';
END $$;

-- --------------------------------------------------------------------------
-- 6. request_refund — refundable ENTRY per policy + cutoff (never the fee)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_t tournaments;
    v_res record; v_reg tournament_registrations; v_refund record;
BEGIN
    -- full refund policy
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Refund — full', 5000, 'player_pays', 'full');
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_res FROM tournament_begin_paid_registration(v_tid);
    PERFORM pg_temp.mark_paid(v_res.registration_id);
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_res.registration_id;

    SELECT * INTO v_refund FROM tournament_request_refund(v_reg.id, v_reg.version);
    ASSERT v_refund.refundable_entry_cents = 5000, 'full policy should refund the entry (5000), got ' || v_refund.refundable_entry_cents;
    ASSERT v_refund.entry_cents = 5000, 'entry snapshot should be 5000';
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_res.registration_id;
    ASSERT v_reg.status = 'withdrawn', 'refund should withdraw the registration, got ' || v_reg.status;

    RAISE NOTICE 'PASS 6a: full policy refunds entry (fee retained), registration withdrawn';
END $$;

DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_t tournaments;
    v_res record; v_reg tournament_registrations; v_refund record;
BEGIN
    -- partial refund policy (50% = 5000 bps)
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Refund — partial', 5000, 'player_pays', 'partial', 5000);
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_res FROM tournament_begin_paid_registration(v_tid);
    PERFORM pg_temp.mark_paid(v_res.registration_id);
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_res.registration_id;

    SELECT * INTO v_refund FROM tournament_request_refund(v_reg.id, v_reg.version);
    ASSERT v_refund.refundable_entry_cents = 2500, 'partial 50%% should refund 2500, got ' || v_refund.refundable_entry_cents;

    RAISE NOTICE 'PASS 6b: partial policy refunds the configured percentage of entry';
END $$;

DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_t tournaments;
    v_res record; v_reg tournament_registrations; v_refund record;
BEGIN
    -- 'none' policy AND a past cutoff both zero the refund; test both.
    -- none policy
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Refund — none', 5000, 'player_pays', 'none');
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_res FROM tournament_begin_paid_registration(v_tid);
    PERFORM pg_temp.mark_paid(v_res.registration_id);
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_res.registration_id;
    SELECT * INTO v_refund FROM tournament_request_refund(v_reg.id, v_reg.version);
    ASSERT v_refund.refundable_entry_cents = 0, 'none policy should refund 0, got ' || v_refund.refundable_entry_cents;

    -- full policy but the refund cutoff is in the past -> 0
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Refund — past cutoff', 5000, 'player_pays', 'full', NULL, now() - interval '1 day');
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_res FROM tournament_begin_paid_registration(v_tid);
    PERFORM pg_temp.mark_paid(v_res.registration_id);
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_res.registration_id;
    SELECT * INTO v_refund FROM tournament_request_refund(v_reg.id, v_reg.version);
    ASSERT v_refund.refundable_entry_cents = 0, 'past-cutoff should refund 0 even under full policy, got ' || v_refund.refundable_entry_cents;

    RAISE NOTICE 'PASS 6c: none policy AND past cutoff both refund 0';
END $$;

DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_t tournaments;
    v_res record; v_reg tournament_registrations; v_ok boolean;
BEGIN
    -- ownership + double-refund guards
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Paid Refund — guards', 5000, 'player_pays', 'full');
    PERFORM pg_temp.setup_payouts(v_org, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_res FROM tournament_begin_paid_registration(v_tid);
    PERFORM pg_temp.mark_paid(v_res.registration_id);
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_res.registration_id;

    -- Someone else can't refund your registration.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[3]::text)::text, true);
    v_ok := false;
    BEGIN PERFORM tournament_request_refund(v_reg.id, v_reg.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_OWNER'); END;
    ASSERT v_ok, 'a non-owner refunding should raise NOT_OWNER';

    -- Owner refunds once, then a stale double-tap is rejected (no double refund).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    PERFORM tournament_request_refund(v_reg.id, v_reg.version);
    v_ok := false;
    BEGIN PERFORM tournament_request_refund(v_reg.id, v_reg.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'OPTIMISTIC_LOCK_CONFLICT'); END;
    ASSERT v_ok, 'a second refund on the same version should be rejected';

    RAISE NOTICE 'PASS 6d: refund ownership + double-refund guards';
END $$;

ROLLBACK;
