-- Regression suite for paid tournament registration.
--
-- Covers the defects fixed in migrations 20260721130000..20260721130300:
-- payment bypasses through UPDATE paths, hard-delete and archive orphaning
-- money, the entry rules missing from the paid path, and the exits where a
-- paid player lost their entry.
--
-- Run against a LOCAL db with the standard dev seed (players
-- a1000000-0000-0000-0000-0000000000NN who play tennis, sport id below):
--
--   psql "$(npx supabase status -o json | jq -r .DB_URL)" -f supabase/tests/paid_tournaments_test.sql
--
-- Every line prints OK/BLOCKED (pass) or BROKEN/EXPLOITED (fail). It writes
-- and removes its own '[PAIDTEST]' tournaments; it does not touch other data.
-- Webhook and refund edge-function coverage is not here — those need a served
-- function and a signed Stripe payload; see the commit history for the drivers.

-- Shared setup: one paid tournament, open mode, organizer onboarded.
-- Re-runnable: wipes prior test rows first.

DELETE FROM lt_registration_payment WHERE tournament_registration_id IN (
    SELECT id FROM tournament_registrations WHERE tournament_id IN (
        SELECT id FROM tournaments WHERE name LIKE '[PAIDTEST]%'));
DELETE FROM tournament_registrations WHERE tournament_id IN (
    SELECT id FROM tournaments WHERE name LIKE '[PAIDTEST]%');
DELETE FROM tournaments WHERE name LIKE '[PAIDTEST]%';

INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed, charges_enabled, payouts_enabled, details_submitted)
VALUES ('a1000000-0000-0000-0000-000000000001', 'acct_test_organizer', true, true, true, true)
ON CONFLICT (player_id) DO UPDATE SET onboarding_completed = true, charges_enabled = true;

-- Paid, open-mode tournament in registration_open.
INSERT INTO tournaments (
    id, name, sport_id, max_participants, start_date, end_date,
    organizer_id, status, registration_mode, visibility,
    entry_fee_cents, fee_payer, refund_policy_kind
) VALUES (
    'ffff0000-0000-0000-0000-00000000000a',
    '[PAIDTEST] open paid',
    '67a8f16a-5870-4b4e-86de-5f3895342e58',
    16,
    now() + interval '30 days',
    now() + interval '31 days',
    'a1000000-0000-0000-0000-000000000001',
    'registration_open',
    'open',
    'public',
    5000,
    'player_pays',
    'full'
);

-- Paid, invite_only tournament (for the invite-branch exploit).
INSERT INTO tournaments (
    id, name, sport_id, max_participants, start_date, end_date,
    organizer_id, status, registration_mode, visibility,
    entry_fee_cents, fee_payer, refund_policy_kind
) VALUES (
    'ffff0000-0000-0000-0000-00000000000b',
    '[PAIDTEST] invite paid',
    '67a8f16a-5870-4b4e-86de-5f3895342e58',
    16,
    now() + interval '30 days',
    now() + interval '31 days',
    'a1000000-0000-0000-0000-000000000001',
    'registration_open',
    'invite_only',
    'public',
    5000,
    'player_pays',
    'full'
);
-- Four claimed free-entry bypasses on PAID tournaments.
-- Each prints EXPLOITED (bug present) or BLOCKED (fixed).

\set QUIET on
\pset format unaligned
\pset tuples_only on

-- ============ 1. open mode: begin_paid_registration then tournament_register
DO $$
DECLARE v_status text; v_ledger text;
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002"}', true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000000a', NULL);
    BEGIN
        PERFORM tournament_register('ffff0000-0000-0000-0000-00000000000a', NULL);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'E1 reactivation-branch  : BLOCKED (%)', SQLERRM; RETURN;
    END;
    SELECT status INTO v_status FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000002';
    SELECT p.status INTO v_ledger FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id=p.tournament_registration_id
     WHERE r.tournament_id='ffff0000-0000-0000-0000-00000000000a' AND r.user_id='a1000000-0000-0000-0000-000000000002'
     ORDER BY p.created_at DESC LIMIT 1;
    IF v_status='registered' THEN
        RAISE NOTICE 'E1 reactivation-branch  : EXPLOITED reg=% ledger=%', v_status, v_ledger;
    ELSE
        RAISE NOTICE 'E1 reactivation-branch  : BLOCKED (status=%)', v_status;
    END IF;
END $$;

-- ============ 2. open mode: pay-abandon, reaper withdraws, re-register free
DO $$
DECLARE v_status text;
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003"}', true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000000a', NULL);
    -- simulate the 15-min reaper
    UPDATE tournament_registrations SET status='withdrawn', withdrawn_at=now()
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000003';
    BEGIN
        PERFORM tournament_register('ffff0000-0000-0000-0000-00000000000a', NULL);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'E2 withdrawn-reregister : BLOCKED (%)', SQLERRM; RETURN;
    END;
    SELECT status INTO v_status FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000003';
    IF v_status='registered' THEN RAISE NOTICE 'E2 withdrawn-reregister : EXPLOITED reg=%', v_status;
    ELSE RAISE NOTICE 'E2 withdrawn-reregister : BLOCKED (status=%)', v_status; END IF;
END $$;

-- ============ 3. invite_only: organizer invites, invitee calls tournament_register
DO $$
DECLARE v_status text;
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001"}', true);
    PERFORM tournament_invite_players('ffff0000-0000-0000-0000-00000000000b', ARRAY['a1000000-0000-0000-0000-000000000004']::uuid[]);
    PERFORM set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000004"}', true);
    BEGIN
        PERFORM tournament_register('ffff0000-0000-0000-0000-00000000000b', NULL);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'E3 invite-branch        : BLOCKED (%)', SQLERRM; RETURN;
    END;
    SELECT status INTO v_status FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000b' AND user_id='a1000000-0000-0000-0000-000000000004';
    IF v_status='registered' THEN RAISE NOTICE 'E3 invite-branch        : EXPLOITED reg=%', v_status;
    ELSE RAISE NOTICE 'E3 invite-branch        : BLOCKED (status=%)', v_status; END IF;
END $$;

-- ============ 4. organizer approves a pending paid invite = free comped spot
DO $$
DECLARE v_status text; v_reg_id uuid; v_ver integer;
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001"}', true);
    PERFORM tournament_invite_players('ffff0000-0000-0000-0000-00000000000b', ARRAY['a1000000-0000-0000-0000-000000000005']::uuid[]);
    SELECT id, version INTO v_reg_id, v_ver FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000b' AND user_id='a1000000-0000-0000-0000-000000000005';
    BEGIN
        PERFORM tournament_approve_registration(v_reg_id, v_ver);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'E4 organizer-approve    : BLOCKED (%)', SQLERRM; RETURN;
    END;
    SELECT status INTO v_status FROM tournament_registrations WHERE id=v_reg_id;
    IF v_status='registered' THEN RAISE NOTICE 'E4 organizer-approve    : EXPLOITED reg=%', v_status;
    ELSE RAISE NOTICE 'E4 organizer-approve    : BLOCKED (status=%)', v_status; END IF;
END $$;
-- E5: share-link join on a paid tournament, fresh AND withdrawn-reactivation.
DO $$
DECLARE v_token text; v_st text; v_reg uuid;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
    SELECT token INTO v_token FROM tournament_invite_get_or_create('ffff0000-0000-0000-0000-00000000000a');

    -- 5a: fresh join via share link (INSERT path)
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000020"}',true);
    BEGIN
        PERFORM tournament_join_via_invite(v_token, NULL);
        SELECT status INTO v_st FROM tournament_registrations
         WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000020';
        RAISE NOTICE 'E5a link-join fresh     : EXPLOITED reg=%', v_st;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'E5a link-join fresh     : BLOCKED (%)', SQLERRM;
    END;

    -- 5b: withdrawn row reactivated via share link (UPDATE path)
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000021"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000000a', NULL);
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000021';
    UPDATE tournament_registrations SET status='withdrawn', withdrawn_at=now() WHERE id=v_reg;
    BEGIN
        PERFORM tournament_join_via_invite(v_token, NULL);
        SELECT status INTO v_st FROM tournament_registrations WHERE id=v_reg;
        IF v_st='registered' THEN RAISE NOTICE 'E5b link-join reactivate: EXPLOITED reg=%', v_st;
        ELSE RAISE NOTICE 'E5b link-join reactivate: BLOCKED (status=%)', v_st; END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'E5b link-join reactivate: BLOCKED (%)', SQLERRM;
    END;
END $$;
-- Legitimate paths that MUST keep working after the payment-gate fix.
-- Each prints OK or BROKEN.

-- Free tournament for the free-path checks.
DELETE FROM tournament_registrations WHERE tournament_id='ffff0000-0000-0000-0000-00000000000c';
DELETE FROM tournaments WHERE id='ffff0000-0000-0000-0000-00000000000c';
INSERT INTO tournaments (id,name,sport_id,max_participants,start_date,end_date,organizer_id,status,registration_mode,visibility,entry_fee_cents)
VALUES ('ffff0000-0000-0000-0000-00000000000c','[PAIDTEST] free','67a8f16a-5870-4b4e-86de-5f3895342e58',16,
        now()+interval '30 days',now()+interval '31 days','a1000000-0000-0000-0000-000000000001','registration_open','open','public',0);

-- R1: free tournament self-register
DO $$
DECLARE v_st text;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000010"}',true);
    PERFORM tournament_register('ffff0000-0000-0000-0000-00000000000c', NULL);
    SELECT status INTO v_st FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000c' AND user_id='a1000000-0000-0000-0000-000000000010';
    IF v_st='registered' THEN RAISE NOTICE 'R1 free register        : OK';
    ELSE RAISE NOTICE 'R1 free register        : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R1 free register        : BROKEN (%)', SQLERRM;
END $$;

-- R2: paid reservation (begin_paid_registration) still allowed
DO $$
DECLARE v_st text;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000011"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000000a', NULL);
    SELECT status INTO v_st FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000011';
    IF v_st='payment_pending' THEN RAISE NOTICE 'R2 paid reservation     : OK';
    ELSE RAISE NOTICE 'R2 paid reservation     : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R2 paid reservation     : BROKEN (%)', SQLERRM;
END $$;

-- R3: webhook finalize (ledger succeeded, then flip) must succeed
DO $$
DECLARE v_st text; v_reg uuid;
BEGIN
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000011';
    UPDATE lt_registration_payment SET status='succeeded' WHERE tournament_registration_id=v_reg;
    UPDATE tournament_registrations SET status='registered', approved_at=now() WHERE id=v_reg AND status='payment_pending';
    SELECT status INTO v_st FROM tournament_registrations WHERE id=v_reg;
    IF v_st='registered' THEN RAISE NOTICE 'R3 webhook finalize     : OK';
    ELSE RAISE NOTICE 'R3 webhook finalize     : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R3 webhook finalize     : BROKEN (%)', SQLERRM;
END $$;

-- R4: organizer invite insert (pending + invited_by) on a paid tournament
DO $$
DECLARE v_st text;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
    PERFORM tournament_invite_players('ffff0000-0000-0000-0000-00000000000a', ARRAY['a1000000-0000-0000-0000-000000000012']::uuid[]);
    SELECT status INTO v_st FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000012';
    IF v_st='pending' THEN RAISE NOTICE 'R4 organizer invite     : OK';
    ELSE RAISE NOTICE 'R4 organizer invite     : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R4 organizer invite     : BROKEN (%)', SQLERRM;
END $$;

-- R5: reaper (payment_pending -> withdrawn) must still work
DO $$
DECLARE v_st text; v_reg uuid;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000013"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000000a', NULL);
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000013';
    UPDATE tournament_registrations SET status='withdrawn', withdrawn_at=now() WHERE id=v_reg;
    SELECT status INTO v_st FROM tournament_registrations WHERE id=v_reg;
    IF v_st='withdrawn' THEN RAISE NOTICE 'R5 reaper withdraw      : OK';
    ELSE RAISE NOTICE 'R5 reaper withdraw      : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R5 reaper withdraw      : BROKEN (%)', SQLERRM;
END $$;

-- R6: refund path (paid registered -> withdrawn) must still work
DO $$
DECLARE v_st text; v_reg uuid;
BEGIN
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000011';
    UPDATE tournament_registrations SET status='withdrawn', withdrawn_at=now() WHERE id=v_reg;
    SELECT status INTO v_st FROM tournament_registrations WHERE id=v_reg;
    IF v_st='withdrawn' THEN RAISE NOTICE 'R6 refund withdraw      : OK';
    ELSE RAISE NOTICE 'R6 refund withdraw      : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R6 refund withdraw      : BROKEN (%)', SQLERRM;
END $$;

-- R7: organizer removal (registered -> disqualified) must still work
DO $$
DECLARE v_st text; v_reg uuid;
BEGIN
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000011';
    UPDATE lt_registration_payment SET status='succeeded' WHERE tournament_registration_id=v_reg;
    UPDATE tournament_registrations SET status='registered' WHERE id=v_reg;
    UPDATE tournament_registrations SET status='disqualified' WHERE id=v_reg;
    SELECT status INTO v_st FROM tournament_registrations WHERE id=v_reg;
    IF v_st='disqualified' THEN RAISE NOTICE 'R7 organizer removal    : OK';
    ELSE RAISE NOTICE 'R7 organizer removal    : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R7 organizer removal    : BROKEN (%)', SQLERRM;
END $$;

-- R8: cancelled-tournament refund marks ledger 'refunded' while the row stays
-- 'registered'; later touches of that row must NOT raise PAYMENT_REQUIRED.
DO $$
DECLARE v_reg uuid;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000014"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000000a', NULL);
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000000a' AND user_id='a1000000-0000-0000-0000-000000000014';
    UPDATE lt_registration_payment SET status='succeeded' WHERE tournament_registration_id=v_reg;
    UPDATE tournament_registrations SET status='registered' WHERE id=v_reg;
    -- cancel-refund: ledger refunded, registration untouched
    UPDATE lt_registration_payment SET status='refunded' WHERE tournament_registration_id=v_reg;
    -- any later touch of the still-registered row
    UPDATE tournament_registrations SET updated_at=now() WHERE id=v_reg;
    RAISE NOTICE 'R8 post-refund touch    : OK';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R8 post-refund touch    : BROKEN (%)', SQLERRM;
END $$;
-- Dedicated tournaments so earlier suites can't pollute the settlement check.
DELETE FROM lt_registration_payment WHERE tournament_registration_id IN
    (SELECT id FROM tournament_registrations WHERE tournament_id IN
        ('ffff0000-0000-0000-0000-00000000e001','ffff0000-0000-0000-0000-00000000e003'));
DELETE FROM tournament_registrations WHERE tournament_id IN
    ('ffff0000-0000-0000-0000-00000000e001','ffff0000-0000-0000-0000-00000000e003');
DELETE FROM tournaments WHERE id IN
    ('ffff0000-0000-0000-0000-00000000e001','ffff0000-0000-0000-0000-00000000e003');
INSERT INTO tournaments (id,name,sport_id,max_participants,start_date,end_date,organizer_id,status,registration_mode,visibility,entry_fee_cents,fee_payer,refund_policy_kind)
VALUES ('ffff0000-0000-0000-0000-00000000e001','[PAIDTEST] p1','67a8f16a-5870-4b4e-86de-5f3895342e58',16,
        now()+interval '30 days',now()+interval '31 days','a1000000-0000-0000-0000-000000000001','registration_open','open','public',5000,'player_pays','full'),
       ('ffff0000-0000-0000-0000-00000000e003','[PAIDTEST] p3 free','67a8f16a-5870-4b4e-86de-5f3895342e58',16,
        now()+interval '30 days',now()+interval '31 days','a1000000-0000-0000-0000-000000000001','registration_open','open','public',0,'player_pays','full');

-- P1: archive with money in flight must be blocked
DO $$
DECLARE v_reg uuid; v_ver int;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000e001', NULL);
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000e001' AND user_id='a1000000-0000-0000-0000-000000000007';
    UPDATE lt_registration_payment SET status='succeeded', stripe_charge_id='ch_p1' WHERE tournament_registration_id=v_reg;
    UPDATE tournament_registrations SET status='registered' WHERE id=v_reg;

    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
    SELECT version INTO v_ver FROM tournaments WHERE id='ffff0000-0000-0000-0000-00000000e001';
    PERFORM tournament_cancel('ffff0000-0000-0000-0000-00000000e001','test',v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id='ffff0000-0000-0000-0000-00000000e001';
    BEGIN
        PERFORM tournament_archive('ffff0000-0000-0000-0000-00000000e001', v_ver);
        RAISE NOTICE 'P1 archive w/ money      : BROKEN (allowed)';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'P1 archive w/ money      : BLOCKED (%)', SQLERRM;
    END;

    -- P2: after the cron refunds, archive must succeed
    UPDATE lt_registration_payment SET status='refunded', refunded_at=now() WHERE stripe_charge_id='ch_p1';
    SELECT version INTO v_ver FROM tournaments WHERE id='ffff0000-0000-0000-0000-00000000e001';
    BEGIN
        PERFORM tournament_archive('ffff0000-0000-0000-0000-00000000e001', v_ver);
        RAISE NOTICE 'P2 archive after refund  : OK';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'P2 archive after refund  : BROKEN (%)', SQLERRM;
    END;
END $$;

-- P3: free tournament archive must still work (no ledger rows at all)
DO $$
DECLARE v_ver int;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
    SELECT version INTO v_ver FROM tournaments WHERE id='ffff0000-0000-0000-0000-00000000e003';
    PERFORM tournament_cancel('ffff0000-0000-0000-0000-00000000e003','test',v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id='ffff0000-0000-0000-0000-00000000e003';
    PERFORM tournament_archive('ffff0000-0000-0000-0000-00000000e003', v_ver);
    RAISE NOTICE 'P3 free archive          : OK';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'P3 free archive          : BROKEN (%)', SQLERRM;
END $$;

-- P4: DELETE grant must be gone for authenticated
DO $$
DECLARE v_has boolean;
BEGIN
    SELECT has_table_privilege('authenticated','public.tournaments','DELETE') INTO v_has;
    IF v_has THEN RAISE NOTICE 'P4 delete grant          : BROKEN (still granted)';
    ELSE RAISE NOTICE 'P4 delete grant          : OK (revoked)'; END IF;
END $$;

-- P5: ledger FK must be RESTRICT, so a registration delete cannot wipe history
DO $$
DECLARE v_del char;
BEGIN
    SELECT confdeltype INTO v_del FROM pg_constraint
     WHERE conrelid='public.lt_registration_payment'::regclass
       AND confrelid='public.tournament_registrations'::regclass;
    IF v_del='r' THEN RAISE NOTICE 'P5 ledger FK             : OK (restrict)';
    ELSE RAISE NOTICE 'P5 ledger FK             : BROKEN (ondelete=%)', v_del; END IF;
END $$;
-- Guards on the paid registration path.
-- Rating-gated singles tournament + a doubles tournament.
DELETE FROM lt_registration_payment WHERE tournament_registration_id IN
  (SELECT id FROM tournament_registrations WHERE tournament_id IN
    ('ffff0000-0000-0000-0000-00000000c001','ffff0000-0000-0000-0000-00000000c002','ffff0000-0000-0000-0000-00000000c003'));
DELETE FROM tournament_registrations WHERE tournament_id IN
  ('ffff0000-0000-0000-0000-00000000c001','ffff0000-0000-0000-0000-00000000c002','ffff0000-0000-0000-0000-00000000c003');
DELETE FROM tournaments WHERE id IN
  ('ffff0000-0000-0000-0000-00000000c001','ffff0000-0000-0000-0000-00000000c002','ffff0000-0000-0000-0000-00000000c003');

INSERT INTO tournaments (id,name,sport_id,max_participants,start_date,end_date,organizer_id,status,registration_mode,visibility,entry_fee_cents,fee_payer,refund_policy_kind,min_rating,entry_format)
VALUES
 ('ffff0000-0000-0000-0000-00000000c001','[PAIDTEST] rating gate','67a8f16a-5870-4b4e-86de-5f3895342e58',16,now()+interval '30 days',now()+interval '31 days','a1000000-0000-0000-0000-000000000001','registration_open','open','public',5000,'player_pays','full',9.0,'singles'),
 ('ffff0000-0000-0000-0000-00000000c002','[PAIDTEST] doubles','67a8f16a-5870-4b4e-86de-5f3895342e58',16,now()+interval '30 days',now()+interval '31 days','a1000000-0000-0000-0000-000000000001','registration_open','open','public',5000,'player_pays','full',NULL,'doubles'),
 ('ffff0000-0000-0000-0000-00000000c003','[PAIDTEST] singles ok','67a8f16a-5870-4b4e-86de-5f3895342e58',16,now()+interval '30 days',now()+interval '31 days','a1000000-0000-0000-0000-000000000001','registration_open','open','public',5000,'player_pays','full',NULL,'singles');

-- G1: below-floor player cannot pay into a rating-gated draw
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c001', NULL);
    RAISE NOTICE 'G1 rating gate           : BROKEN (allowed)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G1 rating gate           : BLOCKED (%)', SQLERRM;
END $$;

-- G2: partner on a singles draw is refused
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c003','a1000000-0000-0000-0000-000000000008');
    RAISE NOTICE 'G2 partner on singles    : BROKEN (allowed)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G2 partner on singles    : BLOCKED (%)', SQLERRM;
END $$;

-- G3: doubles entry with no partner is refused
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c002', NULL);
    RAISE NOTICE 'G3 doubles no partner    : BROKEN (allowed)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G3 doubles no partner    : BLOCKED (%)', SQLERRM;
END $$;

-- G4: self as partner is refused
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c002','a1000000-0000-0000-0000-000000000007');
    RAISE NOTICE 'G4 self as partner       : BROKEN (allowed)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G4 self as partner       : BLOCKED (%)', SQLERRM;
END $$;

-- G5: nonexistent partner is refused
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c002','a1000000-0000-0000-0000-0000000000ff');
    RAISE NOTICE 'G5 ghost partner         : BROKEN (allowed)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G5 ghost partner         : BLOCKED (%)', SQLERRM;
END $$;

-- G6: legit doubles entry succeeds, then the same partner is refused to a second captain
DO $$
DECLARE v_st text;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c002','a1000000-0000-0000-0000-000000000008');
    SELECT status INTO v_st FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000c002' AND user_id='a1000000-0000-0000-0000-000000000007';
    IF v_st='payment_pending' THEN RAISE NOTICE 'G6a legit doubles        : OK';
    ELSE RAISE NOTICE 'G6a legit doubles        : BROKEN (%)', v_st; END IF;

    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000009"}',true);
    BEGIN
        PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c002','a1000000-0000-0000-0000-000000000008');
        RAISE NOTICE 'G6b partner double-book  : BROKEN (allowed)';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G6b partner double-book  : BLOCKED (%)', SQLERRM;
    END;
END $$;

-- G7: disqualified player cannot pay their way back in
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c003', NULL);
    UPDATE tournament_registrations SET status='disqualified'
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000c003' AND user_id='a1000000-0000-0000-0000-000000000002';
    BEGIN
        PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c003', NULL);
        RAISE NOTICE 'G7 disqualified re-entry : BROKEN (allowed)';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G7 disqualified re-entry : BLOCKED (%)', SQLERRM;
    END;
END $$;

-- G8: ordinary paid singles registration still works
DO $$
DECLARE v_st text;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000003"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c003', NULL);
    SELECT status INTO v_st FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000c003' AND user_id='a1000000-0000-0000-0000-000000000003';
    IF v_st='payment_pending' THEN RAISE NOTICE 'G8 normal paid register  : OK';
    ELSE RAISE NOTICE 'G8 normal paid register  : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G8 normal paid register  : BROKEN (%)', SQLERRM;
END $$;

-- G9: a player who meets the floor can still pay into a gated draw
DO $$
DECLARE v_st text; v_rating double precision;
BEGIN
    UPDATE tournaments SET min_rating=1.0 WHERE id='ffff0000-0000-0000-0000-00000000c001';
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000c001', NULL);
    SELECT status INTO v_st FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000c001' AND user_id='a1000000-0000-0000-0000-000000000007';
    IF v_st='payment_pending' THEN RAISE NOTICE 'G9 above-floor allowed   : OK';
    ELSE RAISE NOTICE 'G9 above-floor allowed   : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'G9 above-floor allowed   : BROKEN (%)', SQLERRM;
END $$;
-- Paid exit paths: withdraw guard + removal refund.
DELETE FROM lt_registration_payment WHERE tournament_registration_id IN
  (SELECT id FROM tournament_registrations WHERE tournament_id IN
    ('ffff0000-0000-0000-0000-00000000e101','ffff0000-0000-0000-0000-00000000e102'));
DELETE FROM tournament_registrations WHERE tournament_id IN
  ('ffff0000-0000-0000-0000-00000000e101','ffff0000-0000-0000-0000-00000000e102');
DELETE FROM tournaments WHERE id IN ('ffff0000-0000-0000-0000-00000000e101','ffff0000-0000-0000-0000-00000000e102');
INSERT INTO tournaments (id,name,sport_id,max_participants,start_date,end_date,organizer_id,status,registration_mode,visibility,entry_fee_cents,fee_payer,refund_policy_kind)
VALUES ('ffff0000-0000-0000-0000-00000000e101','[PAIDTEST] paid exit','67a8f16a-5870-4b4e-86de-5f3895342e58',16,now()+interval '30 days',now()+interval '31 days','a1000000-0000-0000-0000-000000000001','registration_open','open','public',5000,'player_pays','full'),
       ('ffff0000-0000-0000-0000-00000000e102','[PAIDTEST] free exit','67a8f16a-5870-4b4e-86de-5f3895342e58',16,now()+interval '30 days',now()+interval '31 days','a1000000-0000-0000-0000-000000000001','registration_open','open','public',0,'player_pays','full');

-- X1: paid player cannot silently forfeit via tournament_withdraw
DO $$
DECLARE v_reg uuid; v_ver int;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000e101', NULL);
    SELECT id INTO v_reg FROM tournament_registrations WHERE tournament_id='ffff0000-0000-0000-0000-00000000e101';
    UPDATE lt_registration_payment SET status='succeeded', stripe_charge_id='ch_x1' WHERE tournament_registration_id=v_reg;
    UPDATE tournament_registrations SET status='registered' WHERE id=v_reg;
    SELECT version INTO v_ver FROM tournament_registrations WHERE id=v_reg;
    BEGIN
        PERFORM tournament_withdraw(v_reg, v_ver);
        RAISE NOTICE 'X1 paid silent forfeit   : BROKEN (allowed)';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'X1 paid silent forfeit   : BLOCKED (%)', SQLERRM;
    END;
END $$;

-- X2: the refund path still works for that same player
DO $$
DECLARE v_reg uuid; v_ver int; v_refundable int;
BEGIN
    SELECT id, version INTO v_reg, v_ver FROM tournament_registrations WHERE tournament_id='ffff0000-0000-0000-0000-00000000e101';
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000007"}',true);
    SELECT refundable_entry_cents INTO v_refundable FROM tournament_request_refund(v_reg, v_ver);
    IF v_refundable = 5000 THEN RAISE NOTICE 'X2 refund path works     : OK (refundable=%)', v_refundable;
    ELSE RAISE NOTICE 'X2 refund path works     : BROKEN (refundable=%)', v_refundable; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'X2 refund path works     : BROKEN (%)', SQLERRM;
END $$;

-- X3: free player can still withdraw normally
DO $$
DECLARE v_reg uuid; v_ver int; v_st text;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000008"}',true);
    PERFORM tournament_register('ffff0000-0000-0000-0000-00000000e102', NULL);
    SELECT id, version INTO v_reg, v_ver FROM tournament_registrations WHERE tournament_id='ffff0000-0000-0000-0000-00000000e102';
    PERFORM tournament_withdraw(v_reg, v_ver);
    SELECT status INTO v_st FROM tournament_registrations WHERE id=v_reg;
    IF v_st='withdrawn' THEN RAISE NOTICE 'X3 free withdraw         : OK';
    ELSE RAISE NOTICE 'X3 free withdraw         : BROKEN (%)', v_st; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'X3 free withdraw         : BROKEN (%)', SQLERRM;
END $$;

-- X4: organizer removal of a paid player queues a refund
DO $$
DECLARE v_reg uuid; v_ver int; v_cands int; v_rel int;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000009"}',true);
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000e101', NULL);
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000e101' AND user_id='a1000000-0000-0000-0000-000000000009';
    UPDATE lt_registration_payment SET status='succeeded', stripe_charge_id='ch_x4' WHERE tournament_registration_id=v_reg;
    UPDATE tournament_registrations SET status='registered' WHERE id=v_reg;

    SELECT count(*) INTO v_cands FROM lt_cancel_refund_candidates()
     WHERE payment_id IN (SELECT id FROM lt_registration_payment WHERE stripe_charge_id='ch_x4');
    RAISE NOTICE 'X4a refund candidates before removal : %', v_cands;

    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
    SELECT version INTO v_ver FROM tournament_registrations WHERE id=v_reg;
    PERFORM tournament_remove_registration(v_reg, v_ver);

    SELECT count(*) INTO v_cands FROM lt_cancel_refund_candidates()
     WHERE payment_id IN (SELECT id FROM lt_registration_payment WHERE stripe_charge_id='ch_x4');
    IF v_cands = 1 THEN RAISE NOTICE 'X4b removal queues refund: OK (candidates=%)', v_cands;
    ELSE RAISE NOTICE 'X4b removal queues refund: BROKEN (candidates=%)', v_cands; END IF;

    -- and must NOT also be paid out to the organizer
    UPDATE tournaments SET status='completed', start_date=now()-interval '72 hours', end_date=now()-interval '48 hours' WHERE id='ffff0000-0000-0000-0000-00000000e101';
    SELECT count(*) INTO v_rel FROM lt_release_candidates()
     WHERE payment_id IN (SELECT id FROM lt_registration_payment WHERE stripe_charge_id='ch_x4');
    IF v_rel = 0 THEN RAISE NOTICE 'X4c removed not paid out : OK';
    ELSE RAISE NOTICE 'X4c removed not paid out : BROKEN (release candidates=%)', v_rel; END IF;
END $$;

-- X5: a normal completed paid registration IS still paid out
DO $$
DECLARE v_reg uuid; v_rel int;
BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002"}',true);
    UPDATE tournaments SET status='registration_open' WHERE id='ffff0000-0000-0000-0000-00000000e101';
    PERFORM tournament_begin_paid_registration('ffff0000-0000-0000-0000-00000000e101', NULL);
    SELECT id INTO v_reg FROM tournament_registrations
     WHERE tournament_id='ffff0000-0000-0000-0000-00000000e101' AND user_id='a1000000-0000-0000-0000-000000000002';
    UPDATE lt_registration_payment SET status='succeeded', stripe_charge_id='ch_x5' WHERE tournament_registration_id=v_reg;
    UPDATE tournament_registrations SET status='registered' WHERE id=v_reg;
    UPDATE tournaments SET status='completed', start_date=now()-interval '72 hours', end_date=now()-interval '48 hours' WHERE id='ffff0000-0000-0000-0000-00000000e101';
    SELECT count(*) INTO v_rel FROM lt_release_candidates()
     WHERE payment_id IN (SELECT id FROM lt_registration_payment WHERE stripe_charge_id='ch_x5');
    IF v_rel = 1 THEN RAISE NOTICE 'X5 normal payout intact  : OK';
    ELSE RAISE NOTICE 'X5 normal payout intact  : BROKEN (release candidates=%)', v_rel; END IF;
END $$;

-- ------------------------------------------------------------------ cleanup
DELETE FROM lt_registration_payment WHERE tournament_registration_id IN
  (SELECT id FROM tournament_registrations WHERE tournament_id IN
    (SELECT id FROM tournaments WHERE name LIKE '[PAIDTEST]%'));
DELETE FROM tournament_registrations WHERE tournament_id IN
  (SELECT id FROM tournaments WHERE name LIKE '[PAIDTEST]%');
DELETE FROM tournaments WHERE name LIKE '[PAIDTEST]%';
