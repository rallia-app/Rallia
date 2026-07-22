-- ============================================
-- Tournament paid registration — SECURITY / REGRESSION suite
--
-- Guards the vulnerabilities fixed in migrations 20260721130000..130300:
--   * payment bypasses through UPDATE paths (a paid slot reaching 'registered'
--     without a succeeded payment)
--   * hard-delete and early-archive orphaning live money
--   * the entry rules (rating / partner / removal) missing from the paid path
--   * the exits where a paid player lost their entry (silent withdraw, removal)
--
-- The sibling tournament_paid_registration_test.sql covers the happy paths, fee
-- math and basic guards; this file covers only the adversarial cases, so the two
-- don't overlap.
--
-- Convention (shared with every other file in this dir): one transaction,
-- ROLLBACK at the end, ASSERT for every check so a regression is a hard error
-- with a non-zero psql exit. Auth is simulated via the request.jwt.claims GUC
-- that auth.uid() reads. Runs as postgres, which bypasses RLS — the SECURITY
-- DEFINER RPCs and their triggers are what's under test.
--
--   psql "$(npx supabase status -o json | jq -r .DB_URL)" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_paid_registration_security_test.sql
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- Helpers (mirrors of the sibling file's; each test file is self-contained).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_paid_draft(
    p_name      text,
    p_mode      tournament_registration_mode DEFAULT 'open',
    p_format    entry_format                 DEFAULT 'singles',
    p_max       integer                      DEFAULT 8,
    p_fee_payer fee_payer_enum               DEFAULT 'player_pays',
    p_refund    refund_policy_kind_enum      DEFAULT 'full',
    OUT o_org   uuid,
    OUT o_players uuid[],
    OUT o_tid   uuid
)
LANGUAGE plpgsql AS $$
DECLARE v_sport uuid; v_t tournaments;
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
        p_visibility => 'public', p_registration_mode => p_mode, p_entry_format => p_format);
    o_tid := v_t.id;

    UPDATE tournaments
       SET entry_fee_cents = 5000, currency = 'CAD', fee_payer = p_fee_payer,
           refund_policy_kind = p_refund
     WHERE id = o_tid;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.setup_payouts(p_org uuid, p_completed boolean DEFAULT true)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed)
    VALUES (p_org, 'acct_test_' || left(p_org::text, 8), p_completed)
    ON CONFLICT (player_id) DO UPDATE SET onboarding_completed = EXCLUDED.onboarding_completed;
$$;

-- Open a paid draft for registration (organizer onboarded).
CREATE OR REPLACE FUNCTION pg_temp.open_paid(p_org uuid, p_tid uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_v integer;
BEGIN
    PERFORM pg_temp.setup_payouts(p_org);
    SELECT version INTO v_v FROM tournaments WHERE id = p_tid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_org::text)::text, true);
    PERFORM tournament_open_registration(p_tid, v_v);
END $$;

-- Simulate the Stripe webhook: ledger -> succeeded, then finalize the slot. This
-- is the ONLY legitimate way a paid slot reaches 'registered'.
CREATE OR REPLACE FUNCTION pg_temp.mark_paid(p_reg uuid)
RETURNS void LANGUAGE sql AS $$
    UPDATE lt_registration_payment
       SET status = 'succeeded', stripe_charge_id = 'ch_' || left(p_reg::text, 8), updated_at = now()
     WHERE tournament_registration_id = p_reg AND status = 'pending';
    UPDATE tournament_registrations
       SET status = 'registered', updated_at = now()
     WHERE id = p_reg AND status = 'payment_pending';
$$;

-- Reserve a paid slot as a given player; returns the registration id.
CREATE OR REPLACE FUNCTION pg_temp.reserve(p_tid uuid, p_player uuid, p_partner uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_reg uuid;
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_player::text)::text, true);
    SELECT registration_id INTO v_reg FROM tournament_begin_paid_registration(p_tid, p_partner);
    RETURN v_reg;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_player(p_player uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_player::text)::text, true);
$$;

-- ==========================================================================
-- 1. Payment bypasses — a paid slot may only reach 'registered' with a
--    succeeded payment. Every UPDATE path used to walk past the INSERT-only gate.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_reg uuid; v_ok boolean; v_st text; v_v int;
BEGIN
    -- 1a. begin_paid then tournament_register (reactivation branch): its
    --     ALREADY_REGISTERED check never looked at payment_pending.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 1a');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    PERFORM pg_temp.reserve(v_tid, v_players[2]);
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM tournament_register(v_tid, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYMENT_REQUIRED'); END;
    ASSERT v_ok, '1a: begin_paid then tournament_register must raise PAYMENT_REQUIRED';
    SELECT status INTO v_st FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_players[2];
    ASSERT v_st = 'payment_pending', '1a: row must stay payment_pending, got ' || v_st;

    -- 1b. Abandon checkout, let the reaper withdraw, re-register free.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 1b');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    v_reg := pg_temp.reserve(v_tid, v_players[2]);
    UPDATE tournament_registrations SET status = 'withdrawn', withdrawn_at = now() WHERE id = v_reg;  -- reaper
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM tournament_register(v_tid, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYMENT_REQUIRED'); END;
    ASSERT v_ok, '1b: re-register after reaper must raise PAYMENT_REQUIRED';

    -- 1c. invite_only: organizer invites, invitee calls tournament_register
    --     (invite branch UPDATE, no fee check).
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Sec 1c', 'invite_only');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    PERFORM pg_temp.as_player(v_org);
    PERFORM tournament_invite_players(v_tid, ARRAY[v_players[3]]);
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[3]);
    BEGIN PERFORM tournament_register(v_tid, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYMENT_REQUIRED'); END;
    ASSERT v_ok, '1c: invitee tournament_register must raise PAYMENT_REQUIRED';

    -- 1d. Organizer approves a pending paid invite = free comped spot.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Sec 1d', 'invite_only');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    PERFORM pg_temp.as_player(v_org);
    PERFORM tournament_invite_players(v_tid, ARRAY[v_players[3]]);
    SELECT id, version INTO v_reg, v_v FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_players[3];
    v_ok := false;
    BEGIN PERFORM tournament_approve_registration(v_reg, v_v);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYMENT_REQUIRED'); END;
    ASSERT v_ok, '1d: approving a paid invite must raise PAYMENT_REQUIRED';

    -- 1e. Share-link join, fresh (INSERT) and reactivation (UPDATE).
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 1e');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    PERFORM pg_temp.as_player(v_org);
    DECLARE v_token text;
    BEGIN
        SELECT token INTO v_token FROM tournament_invite_get_or_create(v_tid);
        v_ok := false;
        PERFORM pg_temp.as_player(v_players[4]);
        BEGIN PERFORM tournament_join_via_invite(v_token, NULL);
        EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYMENT_REQUIRED'); END;
        ASSERT v_ok, '1e: fresh share-link join must raise PAYMENT_REQUIRED';

        v_reg := pg_temp.reserve(v_tid, v_players[5]);
        UPDATE tournament_registrations SET status = 'withdrawn', withdrawn_at = now() WHERE id = v_reg;
        v_ok := false;
        PERFORM pg_temp.as_player(v_players[5]);
        BEGIN PERFORM tournament_join_via_invite(v_token, NULL);
        EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAYMENT_REQUIRED'); END;
        ASSERT v_ok, '1e: share-link reactivation must raise PAYMENT_REQUIRED';
    END;

    -- 1f. Positive control: the webhook finalize IS allowed to reach registered.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 1f');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    v_reg := pg_temp.reserve(v_tid, v_players[2]);
    PERFORM pg_temp.mark_paid(v_reg);
    SELECT status INTO v_st FROM tournament_registrations WHERE id = v_reg;
    ASSERT v_st = 'registered', '1f: paid webhook finalize must reach registered, got ' || v_st;

    RAISE NOTICE 'PASS 1: payment bypasses blocked; legitimate finalize still works';
END $$;

-- ==========================================================================
-- 2. Money can't be orphaned at the lifecycle ends (delete + archive).
-- ==========================================================================
DO $$
DECLARE v_org uuid; v_players uuid[]; v_tid uuid; v_reg uuid; v_v int; v_ok boolean; v_del char;
BEGIN
    -- 2a. authenticated no longer holds DELETE on tournaments.
    ASSERT NOT has_table_privilege('authenticated', 'public.tournaments', 'DELETE'),
        '2a: authenticated must not have DELETE on tournaments';

    -- 2b. the ledger FK is RESTRICT, so no cascade can wipe payment history.
    SELECT confdeltype INTO v_del FROM pg_constraint
     WHERE conrelid = 'public.lt_registration_payment'::regclass
       AND confrelid = 'public.tournament_registrations'::regclass;
    ASSERT v_del = 'r', '2b: ledger->registration FK must be ON DELETE RESTRICT, got ' || v_del;

    -- 2c. archive is blocked while a succeeded payment is unrefunded/unpaid-out.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 2c');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    v_reg := pg_temp.reserve(v_tid, v_players[2]);
    PERFORM pg_temp.mark_paid(v_reg);
    PERFORM pg_temp.as_player(v_org);
    SELECT version INTO v_v FROM tournaments WHERE id = v_tid;
    PERFORM tournament_cancel(v_tid, 'test', v_v);
    SELECT version INTO v_v FROM tournaments WHERE id = v_tid;
    v_ok := false;
    BEGIN PERFORM tournament_archive(v_tid, v_v);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'SETTLEMENT_PENDING'); END;
    ASSERT v_ok, '2c: archive with money in flight must raise SETTLEMENT_PENDING';

    -- 2d. once the refund lands, archive succeeds.
    UPDATE lt_registration_payment SET status = 'refunded', refunded_at = now()
     WHERE tournament_registration_id = v_reg;
    SELECT version INTO v_v FROM tournaments WHERE id = v_tid;
    PERFORM tournament_archive(v_tid, v_v);
    ASSERT (SELECT status FROM tournaments WHERE id = v_tid) = 'archived',
        '2d: archive must succeed once settled';

    RAISE NOTICE 'PASS 2: delete revoked, ledger FK restricted, archive gated on settlement';
END $$;

-- ==========================================================================
-- 3. The paid path enforces the same entry rules as tournament_register.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_ok boolean; v_st text;
    v_rated uuid; v_rating numeric; v_nontennis uuid; v_partner uuid;
BEGIN
    -- 3a. below-floor player cannot pay into a rating-gated draw.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 3a');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    SELECT ps.player_id, rs.value INTO v_rated, v_rating
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs ON rs.id = prs.rating_score_id
      JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active AND ps.player_id <> v_org
     ORDER BY ps.player_id LIMIT 1;
    ASSERT v_rated IS NOT NULL, '3a: need a rated tennis player';
    UPDATE tournaments SET min_rating = v_rating + 0.5 WHERE id = v_tid;
    v_ok := false;
    PERFORM pg_temp.as_player(v_rated);
    BEGIN PERFORM tournament_begin_paid_registration(v_tid, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'RATING_TOO_LOW'); END;
    ASSERT v_ok, '3a: below-floor player must raise RATING_TOO_LOW';
    ASSERT NOT EXISTS (SELECT 1 FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_rated),
        '3a: no slot may be reserved for a refused player';

    -- 3b. same player is allowed once the floor is below their rating. Set it a
    --     clear margin below so numeric(3,1) rounding can't spuriously trip it.
    UPDATE tournaments SET min_rating = v_rating - 0.5 WHERE id = v_tid;
    PERFORM pg_temp.as_player(v_rated);
    PERFORM tournament_begin_paid_registration(v_tid, NULL);
    SELECT status INTO v_st FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_rated;
    ASSERT v_st = 'payment_pending', '3b: above-floor player must be allowed, got ' || v_st;

    -- 3c. partner validation on a singles draw: partner not allowed.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 3c');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM tournament_begin_paid_registration(v_tid, v_players[3]);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PARTNER_NOT_ALLOWED'); END;
    ASSERT v_ok, '3c: partner on a singles draw must raise PARTNER_NOT_ALLOWED';

    -- 3d. doubles: no partner, self partner, ghost partner, sport-mismatch partner.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_paid_draft('Sec 3d', 'open', 'doubles');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    PERFORM pg_temp.as_player(v_players[2]);

    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PARTNER_REQUIRED'); END;
    ASSERT v_ok, '3d: doubles with no partner must raise PARTNER_REQUIRED';

    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid, v_players[2]);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PARTNER_INVALID'); END;
    ASSERT v_ok, '3d: self as partner must raise PARTNER_INVALID';

    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid, gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PARTNER_INVALID'); END;
    ASSERT v_ok, '3d: ghost partner must raise PARTNER_INVALID';

    SELECT p.id INTO v_nontennis FROM player p
     WHERE NOT EXISTS (SELECT 1 FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
                        WHERE ps.player_id = p.id AND s.name = 'tennis' AND ps.is_active)
     LIMIT 1;
    ASSERT v_nontennis IS NOT NULL, '3d: need a non-tennis player';
    v_ok := false;
    BEGIN PERFORM tournament_begin_paid_registration(v_tid, v_nontennis);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PARTNER_SPORT_MISMATCH'); END;
    ASSERT v_ok, '3d: partner not playing the sport must raise PARTNER_SPORT_MISMATCH';

    -- 3e. legit doubles reserves, then the same partner can't be double-booked.
    PERFORM pg_temp.as_player(v_players[2]);
    PERFORM tournament_begin_paid_registration(v_tid, v_players[3]);
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[4]);
    BEGIN PERFORM tournament_begin_paid_registration(v_tid, v_players[3]);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PARTNER_ALREADY_REGISTERED'); END;
    ASSERT v_ok, '3e: double-booked partner must raise PARTNER_ALREADY_REGISTERED';

    -- 3f. an organizer-removed player cannot pay their way back in.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 3f');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    PERFORM pg_temp.reserve(v_tid, v_players[2]);
    UPDATE tournament_registrations SET status = 'disqualified'
     WHERE tournament_id = v_tid AND user_id = v_players[2];
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM tournament_begin_paid_registration(v_tid, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'REGISTRATION_REMOVED'); END;
    ASSERT v_ok, '3f: disqualified player must raise REGISTRATION_REMOVED';

    RAISE NOTICE 'PASS 3: paid path enforces rating, partner and removal rules';
END $$;

-- ==========================================================================
-- 4. Exit paths — a paid player never loses their entry involuntarily.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_reg uuid; v_v int; v_ok boolean; v_st text;
    v_free_reg uuid;
BEGIN
    -- 4a. tournament_withdraw refuses a paid entry (must use the refund path).
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 4a');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    v_reg := pg_temp.reserve(v_tid, v_players[2]);
    PERFORM pg_temp.mark_paid(v_reg);
    SELECT version INTO v_v FROM tournament_registrations WHERE id = v_reg;
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM tournament_withdraw(v_reg, v_v);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PAID_USE_REFUND'); END;
    ASSERT v_ok, '4a: withdrawing a paid entry must raise PAID_USE_REFUND';

    -- 4b. the refund path withdraws and returns the full entry.
    SELECT version INTO v_v FROM tournament_registrations WHERE id = v_reg;
    PERFORM pg_temp.as_player(v_players[2]);
    PERFORM tournament_request_refund(v_reg, v_v);
    SELECT status INTO v_st FROM tournament_registrations WHERE id = v_reg;
    ASSERT v_st = 'withdrawn', '4b: refund must withdraw the registration, got ' || v_st;

    -- 4c. a free entry still withdraws normally.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 4c');
    UPDATE tournaments SET entry_fee_cents = 0 WHERE id = v_tid;  -- make it free
    SELECT version INTO v_v FROM tournaments WHERE id = v_tid;
    PERFORM pg_temp.as_player(v_org);
    PERFORM tournament_open_registration(v_tid, v_v);
    PERFORM pg_temp.as_player(v_players[2]);
    PERFORM tournament_register(v_tid, NULL);
    SELECT id, version INTO v_free_reg, v_v FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_players[2];
    PERFORM tournament_withdraw(v_free_reg, v_v);
    SELECT status INTO v_st FROM tournament_registrations WHERE id = v_free_reg;
    ASSERT v_st = 'withdrawn', '4c: free withdraw must work, got ' || v_st;

    -- 4d. organizer removal of a paid player queues a refund and is NOT paid out.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid FROM pg_temp.mk_paid_draft('Sec 4d');
    PERFORM pg_temp.open_paid(v_org, v_tid);
    v_reg := pg_temp.reserve(v_tid, v_players[2]);
    PERFORM pg_temp.mark_paid(v_reg);
    PERFORM pg_temp.as_player(v_org);
    SELECT version INTO v_v FROM tournament_registrations WHERE id = v_reg;
    PERFORM tournament_remove_registration(v_reg, v_v);
    ASSERT EXISTS (SELECT 1 FROM lt_cancel_refund_candidates() c
                    JOIN lt_registration_payment p ON p.id = c.payment_id
                   WHERE p.tournament_registration_id = v_reg),
        '4d: removed paid player must be a refund candidate';

    -- complete the event; the removed player must NOT be a payout candidate.
    UPDATE tournaments SET status = 'completed',
           start_date = now() - interval '72 hours', end_date = now() - interval '48 hours'
     WHERE id = v_tid;
    ASSERT NOT EXISTS (SELECT 1 FROM lt_release_candidates() r
                        JOIN lt_registration_payment p ON p.id = r.payment_id
                       WHERE p.tournament_registration_id = v_reg),
        '4d: removed paid player must not be paid out to the organizer';

    -- 4e. a normal completed registration IS still paid out.
    UPDATE tournaments SET status = 'registration_open',
           start_date = now() + interval '7 days', end_date = now() + interval '8 days'
     WHERE id = v_tid;
    v_reg := pg_temp.reserve(v_tid, v_players[3]);
    PERFORM pg_temp.mark_paid(v_reg);
    UPDATE tournaments SET status = 'completed',
           start_date = now() - interval '72 hours', end_date = now() - interval '48 hours'
     WHERE id = v_tid;
    ASSERT EXISTS (SELECT 1 FROM lt_release_candidates() r
                    JOIN lt_registration_payment p ON p.id = r.payment_id
                   WHERE p.tournament_registration_id = v_reg),
        '4e: a normal completed paid registration must be paid out';

    RAISE NOTICE 'PASS 4: paid exits protected; normal payouts intact';
END $$;

ROLLBACK;
