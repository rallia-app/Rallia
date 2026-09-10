-- ============================================
-- Entry-fee GST/QST — entry_tax_mode (migration 20260910020252)
-- ============================================
-- 20260710210000 taxed the service fee only, on the reasoning that the
-- third-party organizer is merchant of record and owns the entry tax. A
-- Rallia-run event breaks that: the house organizer zeroes the fee, and with
-- the tax hanging off the fee the whole registration records zero tax while
-- the entry has become a supply by a registrant.
--
-- entry_tax_mode is the fix, and the property that matters most here is that
-- it is INERT until somebody sets it:
--
--   none     today's arithmetic, byte for byte. The default.
--   included the listed price is all-in. Tax carved out of it, so the player
--            is charged EXACTLY the same as under 'none' — this is what makes
--            it safe to flip on an event already taking registrations.
--   added    tax on top. The only mode that moves the charge.
--
-- Entry $50.00 (5000c), fee 5% + 14.975% on the fee:
--   fee 250c, fee tax 37c
--   none     entry tax   0c -> player pays 5287c, organizer receives 5000c
--   included entry tax 651c -> player pays 5287c, organizer receives 5000c
--                              (base 4349c + 651c = 5000c exactly)
--   added    entry tax 749c -> player pays 6036c, organizer receives 5749c
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_entry_tax_mode_test.sql
--
-- One transaction, ROLLBACK at the end. Auth via the request.jwt.claims GUC.
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. every existing event defaults to 'none', so nothing changed for anybody
-- Runs before this file creates any fixture of its own, so the counts below
-- are the real world's, not ours.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT count(*) INTO v_bad FROM tournaments WHERE entry_tax_mode <> 'none';
    ASSERT v_bad = 0, 'no tournament should be taxed yet, found ' || v_bad;
    SELECT count(*) INTO v_bad FROM seasons WHERE entry_tax_mode <> 'none';
    ASSERT v_bad = 0, 'no season should be taxed yet, found ' || v_bad;
    SELECT count(*) INTO v_bad FROM lt_registration_payment WHERE entry_tax_cents <> 0;
    ASSERT v_bad = 0, 'no historical payment should carry entry tax, found ' || v_bad;
    RAISE NOTICE '1. default is inert OK';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

CREATE OR REPLACE FUNCTION pg_temp.setup_payouts(p_org uuid)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO player_stripe_account (player_id, stripe_account_id, charges_enabled)
    VALUES (p_org, 'acct_test_' || left(p_org::text, 8), true)
    ON CONFLICT (player_id) DO UPDATE SET charges_enabled = EXCLUDED.charges_enabled;
$$;

-- Paid DRAFT tournament at a given entry-tax mode. Mirrors mk_paid_draft in
-- tournament_paid_registration_test.sql; kept local so the two files can drift
-- independently.
CREATE OR REPLACE FUNCTION pg_temp.mk_taxed_draft(
    p_name     text,
    p_mode     entry_tax_mode_enum,
    p_entry    integer                 DEFAULT 5000,
    p_fee_payer fee_payer_enum         DEFAULT 'player_pays',
    p_refund   refund_policy_kind_enum DEFAULT 'none',
    OUT o_org     uuid,
    OUT o_players uuid[],
    OUT o_tid     uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid;
    v_t     tournaments;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO o_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 4) s;
    ASSERT array_length(o_players, 1) = 4, 'need 4 active tennis players';
    o_org := o_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', o_org::text)::text, true);
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => p_name, p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    PERFORM pg_temp.staff_off(o_org);
    o_tid := v_t.id;

    UPDATE tournaments
       SET entry_fee_cents    = p_entry,
           currency           = 'CAD',
           fee_payer          = p_fee_payer,
           entry_tax_mode     = p_mode,
           refund_policy_kind = p_refund,
           -- non-admin organizers are rate-limited to 5 creates per 24h
           created_at         = now() - interval '2 days'
     WHERE id = o_tid;
END $$;

-- --------------------------------------------------------------------------
-- 2. the math functions on their own
-- --------------------------------------------------------------------------
DO $$
BEGIN
    -- none taxes nothing, whatever the entry
    ASSERT compute_entry_tax_cents(5000, 'none') = 0, 'none must not tax';
    ASSERT compute_entry_tax_cents(0, 'included') = 0, 'a free entry has no tax';
    ASSERT compute_entry_tax_cents(0, 'added') = 0, 'a free entry has no tax';

    -- added: 14.975% on top, the same constant as the fee tax
    ASSERT compute_entry_tax_cents(5000, 'added') = 749,
        'added tax on 5000 should be 749, got ' || compute_entry_tax_cents(5000, 'added');
    ASSERT compute_entry_tax_cents(1500, 'added') = 225,
        '15$ added should be 2.25$, got ' || compute_entry_tax_cents(1500, 'added');

    -- included: carved out, and the split must reconstruct the gross EXACTLY.
    -- This is the property that keeps a tax-included price honest; a naive
    -- entry * 14.975% would over-collect and leave the books off by cents.
    ASSERT compute_entry_tax_cents(5000, 'included') = 651,
        'included tax in 5000 should be 651, got ' || compute_entry_tax_cents(5000, 'included');
    ASSERT compute_entry_tax_cents(1500, 'included') = 195,
        '15$ all-in should hold 1.95$ of tax, got ' || compute_entry_tax_cents(1500, 'included');
    ASSERT ROUND((1500 - 195) * 1.14975) = 1500, 'included must round-trip to the listed price';
    ASSERT ROUND((5000 - 651) * 1.14975) = 5000, 'included must round-trip to the listed price';

    -- the refundable base: added is on top of the entry, included is inside it
    ASSERT lt_entry_charged_cents(5000, 0,   'none')     = 5000, 'none charges the entry';
    ASSERT lt_entry_charged_cents(5000, 651, 'included') = 5000, 'included must not add the tax twice';
    ASSERT lt_entry_charged_cents(5000, 749, 'added')    = 5749, 'added charges entry + tax';

    RAISE NOTICE '2. entry tax math OK';
END $$;

-- --------------------------------------------------------------------------
-- 3. tournament_fee_quote — none and included charge the SAME
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_tid uuid; v_q record;
BEGIN
    SELECT o_tid INTO v_tid FROM pg_temp.mk_taxed_draft('Entry tax — none', 'none');
    SELECT * INTO v_q FROM tournament_fee_quote(v_tid);
    ASSERT v_q.entry_cents = 5000,              'entry 5000, got ' || v_q.entry_cents;
    ASSERT v_q.entry_tax_cents = 0,             'none must quote 0 entry tax, got ' || v_q.entry_tax_cents;
    ASSERT v_q.service_fee_cents = 250,         'fee 250, got ' || v_q.service_fee_cents;
    ASSERT v_q.fee_tax_cents = 37,              'fee tax 37, got ' || v_q.fee_tax_cents;
    ASSERT v_q.total_cents = 5287,              'none total 5287, got ' || v_q.total_cents;
    ASSERT v_q.organizer_receives_cents = 5000, 'none organizer 5000, got ' || v_q.organizer_receives_cents;

    SELECT o_tid INTO v_tid FROM pg_temp.mk_taxed_draft('Entry tax — included', 'included');
    SELECT * INTO v_q FROM tournament_fee_quote(v_tid);
    ASSERT v_q.entry_cents = 5000,              'included still lists 5000, got ' || v_q.entry_cents;
    ASSERT v_q.entry_tax_cents = 651,           'included entry tax 651, got ' || v_q.entry_tax_cents;
    -- the whole point: the player is charged exactly what 'none' charged
    ASSERT v_q.total_cents = 5287,              'included must not move the price, got ' || v_q.total_cents;
    ASSERT v_q.organizer_receives_cents = 5000, 'included organizer 5000, got ' || v_q.organizer_receives_cents;

    SELECT o_tid INTO v_tid FROM pg_temp.mk_taxed_draft('Entry tax — added', 'added');
    SELECT * INTO v_q FROM tournament_fee_quote(v_tid);
    ASSERT v_q.entry_tax_cents = 749,           'added entry tax 749, got ' || v_q.entry_tax_cents;
    ASSERT v_q.total_cents = 6036,              'added total 6036, got ' || v_q.total_cents;
    ASSERT v_q.organizer_receives_cents = 5749, 'added organizer 5749, got ' || v_q.organizer_receives_cents;

    -- organizer_absorbs still absorbs the FEE only; entry tax is never absorbed,
    -- because 'included' is how an organizer eats it.
    SELECT o_tid INTO v_tid FROM pg_temp.mk_taxed_draft(
        'Entry tax — added + absorbs', 'added', 5000, 'organizer_absorbs');
    SELECT * INTO v_q FROM tournament_fee_quote(v_tid);
    ASSERT v_q.total_cents = 5749,              'absorbs charges entry+entry tax, got ' || v_q.total_cents;
    ASSERT v_q.organizer_receives_cents = 5749 - 250 - 37,
        'absorbs organizer 5462, got ' || v_q.organizer_receives_cents;

    RAISE NOTICE '3. fee quote across the three modes OK';
END $$;

-- --------------------------------------------------------------------------
-- 4. begin_paid_registration snapshots the tax AND the mode
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid;
    v_t tournaments; v_b record; v_p lt_registration_payment;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_taxed_draft('Entry tax — begin included', 'included');
    PERFORM pg_temp.setup_payouts(v_org);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM tournament_open_registration(v_tid, v_t.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_b FROM tournament_begin_paid_registration(v_tid);
    ASSERT v_b.entry_cents = 5000,     'included lists 5000, got ' || v_b.entry_cents;
    ASSERT v_b.entry_tax_cents = 651,  'included snapshots 651, got ' || v_b.entry_tax_cents;
    ASSERT v_b.amount_charged_cents = 5287,
        'included charges the same 5287, got ' || v_b.amount_charged_cents;

    SELECT * INTO v_p FROM lt_registration_payment WHERE id = v_b.payment_id;
    ASSERT v_p.entry_tax_cents = 651,        'ledger tax 651, got ' || v_p.entry_tax_cents;
    ASSERT v_p.entry_tax_mode = 'included',  'ledger must record the mode, got ' || v_p.entry_tax_mode;
    -- entry_cents keeps meaning the listed price, in every mode
    ASSERT v_p.entry_cents = 5000,           'ledger entry 5000, got ' || v_p.entry_cents;

    -- added moves the charge and what settles to the organizer
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_taxed_draft('Entry tax — begin added', 'added');
    PERFORM pg_temp.setup_payouts(v_org);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM tournament_open_registration(v_tid, v_t.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_b FROM tournament_begin_paid_registration(v_tid);
    ASSERT v_b.entry_tax_cents = 749,          'added snapshots 749, got ' || v_b.entry_tax_cents;
    ASSERT v_b.amount_charged_cents = 6036,    'added charges 6036, got ' || v_b.amount_charged_cents;
    ASSERT v_b.organizer_amount_cents = 5749,  'added settles 5749, got ' || v_b.organizer_amount_cents;
    -- the entry tax must NEVER reach Rallia's platform cut: the edge function
    -- builds application_fee_amount from these two columns alone.
    ASSERT v_b.service_fee_cents + v_b.fee_tax_cents = 287,
        'application fee stays fee+fee tax, got ' || (v_b.service_fee_cents + v_b.fee_tax_cents);

    RAISE NOTICE '4. begin_paid_registration snapshot OK';
END $$;

-- --------------------------------------------------------------------------
-- 5. refunds return the entry tax with the entry
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid;
    v_t tournaments; v_b record; v_r record; v_reg tournament_registrations;
    v_cand record;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_taxed_draft('Entry tax — refund added', 'added', 5000, 'player_pays', 'full');
    PERFORM pg_temp.setup_payouts(v_org);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM tournament_open_registration(v_tid, v_t.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_b FROM tournament_begin_paid_registration(v_tid);
    UPDATE lt_registration_payment
       SET status = 'succeeded', stripe_payment_intent_id = 'pi_test', stripe_charge_id = 'ch_test'
     WHERE id = v_b.payment_id;
    UPDATE tournament_registrations SET status = 'registered', version = version + 1
     WHERE id = v_b.registration_id RETURNING * INTO v_reg;

    -- Withdrawing gets the tax back too. The service fee and ITS tax stay with
    -- Rallia (already remitted); entry tax on a supply that did not happen is
    -- not the organizer's to keep.
    SELECT * INTO v_r FROM tournament_request_refund(v_reg.id, v_reg.version);
    ASSERT v_r.refundable_entry_cents = 5749,
        'a full refund returns entry + entry tax = 5749, got ' || v_r.refundable_entry_cents;

    -- and the cancel sweep agrees
    UPDATE tournament_registrations SET status = 'registered' WHERE id = v_b.registration_id;
    UPDATE tournaments SET status = 'cancelled' WHERE id = v_tid;
    SELECT * INTO v_cand FROM lt_cancel_refund_candidates() WHERE payment_id = v_b.payment_id;
    ASSERT v_cand.entry_cents = 5749,
        'cancel sweep refunds entry + entry tax = 5749, got ' || v_cand.entry_cents;

    RAISE NOTICE '5. refund paths OK';
END $$;

ROLLBACK;
