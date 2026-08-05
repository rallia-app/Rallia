-- ============================================
-- lt_event_earnings — organizer earnings aggregate
--
-- Guards migration 20260802210000: the per-event money summary an organizer
-- sees in the app. Covers the arg contract, both event legs (tournament and
-- season), the aggregate math over mixed payment statuses, and the access
-- rule (organizer or admin only).
--
-- Convention (shared with every other file in this dir): one transaction,
-- ROLLBACK at the end, ASSERT for every check so a regression is a hard error
-- with a non-zero psql exit. Auth is simulated via the request.jwt.claims GUC
-- that auth.uid() reads. Runs as postgres, which bypasses RLS — the SECURITY
-- DEFINER RPC is what's under test.
--
-- Structure note: fixture seeding runs under session_replication_role=replica
-- (the payment gate correctly refuses a direct 'registered' insert on a paid
-- event, and this file seeds state rather than exercising the write path).
-- That GUC only accepts a top-level SET LOCAL, hence the phased DO blocks with
-- a temp table carrying ids between them.
--
--   psql "$(npx supabase status -o json | jq -r .DB_URL)" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_event_earnings_test.sql
-- ============================================

BEGIN;

CREATE TEMP TABLE ctx (
    org uuid, other uuid, p3 uuid, p4 uuid, p5 uuid,
    tid uuid, reg1 uuid, reg2 uuid, reg3 uuid,
    lid uuid, sid uuid, sm uuid
) ON COMMIT DROP;

-- ---- phase 1: pick fixtures, create the events (normal trigger regime) ----
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_tid     uuid;
    v_lid     uuid := gen_random_uuid();
    v_sid     uuid := gen_random_uuid();
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    -- Non-admin fixtures only: is_admin() would void the deny-path asserts.
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 5) s;
    ASSERT array_length(v_players, 1) = 5, 'need 5 active non-admin tennis players';

    INSERT INTO tournaments (id, name, sport_id, organizer_id, status, entry_format,
                             registration_mode, visibility, max_participants,
                             start_date, end_date, registration_opens_at, registration_closes_at,
                             entry_fee_cents, currency, fee_payer)
    VALUES (gen_random_uuid(), '[TEST-EARN] t', v_sport, v_players[1], 'registration_open', 'singles',
            'open', 'public', 8,
            now() + interval '7 days', now() + interval '8 days', now() - interval '1 day', now() + interval '5 days',
            2500, 'CAD', 'player_pays')
    RETURNING id INTO v_tid;

    INSERT INTO leagues (id, name, sport_id, organizer_id, status, join_mode, visibility)
    VALUES (v_lid, '[TEST-EARN] l', v_sport, v_players[1], 'active', 'open', 'public');
    INSERT INTO seasons (id, league_id, name, status, start_date, end_date, entry_fee_cents, currency, fee_payer)
    VALUES (v_sid, v_lid, 's', 'open', current_date, current_date + 60, 4000, 'CAD', 'player_pays');

    INSERT INTO ctx (org, other, p3, p4, p5, tid, lid, sid, sm)
    VALUES (v_players[1], v_players[2], v_players[3], v_players[4], v_players[5],
            v_tid, v_lid, v_sid, gen_random_uuid());
END $$;

-- ---- phase 2: seed registrations + ledger with triggers suppressed --------
SET LOCAL session_replication_role = replica;

DO $$
DECLARE c ctx%ROWTYPE; v_reg1 uuid; v_reg2 uuid; v_reg3 uuid;
BEGIN
    SELECT * INTO c FROM ctx;

    INSERT INTO tournament_registrations (id, tournament_id, user_id, status)
    VALUES (gen_random_uuid(), c.tid, c.p3, 'registered') RETURNING id INTO v_reg1;
    INSERT INTO tournament_registrations (id, tournament_id, user_id, status)
    VALUES (gen_random_uuid(), c.tid, c.p4, 'withdrawn') RETURNING id INTO v_reg2;
    INSERT INTO tournament_registrations (id, tournament_id, user_id, status)
    VALUES (gen_random_uuid(), c.tid, c.p5, 'payment_pending') RETURNING id INTO v_reg3;

    INSERT INTO lt_registration_payment
        (tournament_registration_id, payer_user_id, organizer_id, entry_cents, service_fee_cents,
         fee_tax_cents, amount_charged_cents, organizer_amount_cents, fee_payer, currency, status,
         payout_timing, stripe_payment_intent_id)
    VALUES
        (v_reg1, c.p3, c.org, 2500, 125, 19, 2644, 2500, 'player_pays', 'CAD', 'succeeded', 'hold_until_event_end', 'pi_test_earn_1'),
        (v_reg2, c.p4, c.org, 2500, 125, 19, 2644, 2500, 'player_pays', 'CAD', 'refunded',  'hold_until_event_end', 'pi_test_earn_2'),
        (v_reg3, c.p5, c.org, 2500, 125, 19, 2644, 2500, 'player_pays', 'CAD', 'pending',   'hold_until_event_end', 'pi_test_earn_3');
    UPDATE lt_registration_payment SET refund_amount_cents = 2500, refunded_at = now()
     WHERE stripe_payment_intent_id = 'pi_test_earn_2';

    INSERT INTO season_members (id, season_id, user_id, status)
    VALUES (c.sm, c.sid, c.p3, 'enrolled');
    INSERT INTO lt_registration_payment
        (season_id, season_user_id, payer_user_id, organizer_id, entry_cents, service_fee_cents,
         fee_tax_cents, amount_charged_cents, organizer_amount_cents, fee_payer, currency, status,
         payout_timing, stripe_payment_intent_id)
    VALUES (c.sid, c.sm, c.p3, c.org, 4000, 200, 30, 4230, 4000, 'player_pays', 'CAD', 'succeeded', 'hold_until_event_end', 'pi_test_earn_s1');

    UPDATE ctx SET reg1 = v_reg1, reg2 = v_reg2, reg3 = v_reg3;
END $$;

SET LOCAL session_replication_role = DEFAULT;

-- ---- phase 3: exercise the RPC --------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; v_row record; v_err text;
BEGIN
    SELECT * INTO c FROM ctx;

    -- arg contract: exactly one event id
    BEGIN
        PERFORM * FROM lt_event_earnings(NULL, NULL);
        ASSERT false, 'both-null must raise';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'ONE_EVENT_ID_REQUIRED', 'both-null: got ' || v_err;
    END;

    -- tournament leg, as the organizer
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c.org::text)::text, true);
    SELECT * INTO v_row FROM lt_event_earnings(p_tournament_id => c.tid);
    ASSERT v_row.paid_count = 1,     'paid_count: '     || v_row.paid_count;
    ASSERT v_row.pending_count = 1,  'pending_count: '  || v_row.pending_count;
    ASSERT v_row.refunded_count = 1, 'refunded_count: ' || v_row.refunded_count;
    ASSERT v_row.entry_cents = 2500,    'entry_cents: '    || v_row.entry_cents;
    ASSERT v_row.charged_cents = 2644,  'charged_cents: '  || v_row.charged_cents;
    ASSERT v_row.refunded_cents = 2500, 'refunded_cents: ' || v_row.refunded_cents;
    -- the refund sits on a 'refunded' payment, so the succeeded leg is untouched
    ASSERT v_row.net_to_organizer_cents = 2500, 'net: ' || v_row.net_to_organizer_cents;
    ASSERT v_row.currency = 'CAD', 'currency';

    -- access: not the organizer, not admin
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c.other::text)::text, true);
    BEGIN
        PERFORM * FROM lt_event_earnings(p_tournament_id => c.tid);
        ASSERT false, 'non-organizer must be denied';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'NOT_ORGANIZER', 'deny: got ' || v_err;
    END;

    -- season leg, as the organizer
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c.org::text)::text, true);
    SELECT * INTO v_row FROM lt_event_earnings(p_season_id => c.sid);
    ASSERT v_row.paid_count = 1 AND v_row.entry_cents = 4000 AND v_row.net_to_organizer_cents = 4000,
        'season leg: ' || v_row.paid_count || '/' || v_row.entry_cents;

    RAISE NOTICE 'lt_event_earnings_test: all assertions passed';
END $$;

ROLLBACK;
