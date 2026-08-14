-- Reset the demo tester's paid-payments fixtures (staging) back to the start
-- state described in the demo payments test guide (Google Drive).
--
-- Twin of reset-jdl-test-fixtures.sql. Tester: demo@rallia.ca (Alex Monza,
-- 5e0c481b-5360-490e-8576-d1bab41bcbeb). The events he pays into are organized
-- by lefrancmathis@gmail.com and stay untouched here.
--
-- ⚠️ This script deliberately does NOT drop demo's player_stripe_account row,
-- unlike the jdl twin. demo is the ORGANIZER of Jean's paid fixtures, and
-- lt-create-registration-payment reads organizer_onboarded from that row
-- (COALESCE(v_psa.onboarding_completed, false), migration 20260725120000).
-- Deleting it returns organizer_not_ready on every real payment in Jean's
-- sections 4.1/4.2/4.5. Reset it only when demo will re-run his own section 2
-- BEFORE Jean tests, and do it as a separate deliberate step.

SET session_replication_role = replica;

DO $$
DECLARE
  v_demo uuid := '5e0c481b-5360-490e-8576-d1bab41bcbeb';  -- demo@rallia.ca
  v_jdl  uuid := '82928ca5-7406-4cf2-984f-957fce8a2d96';  -- jdl.sonkin+10@gmail.com

  v_draft    uuid := 'dddd0000-0000-0000-0000-0000000000d1';  -- [PAYUI] Draft a publier
  v_organize uuid := 'aaaa0000-0000-0000-0000-0000000000a5';  -- You organize
  v_live     uuid := 'aaaa0000-0000-0000-0000-0000000000a6';  -- LIVE register + pay
  v_absorbs  uuid := 'aaaa0000-0000-0000-0000-0000000000a7';  -- Organizer absorbs
  v_invited  uuid := 'aaaa0000-0000-0000-0000-0000000000a9';  -- You are invited
  v_cancel   uuid;                                            -- [PAYE2E] 8
  v_late     uuid;                                            -- [PAYE2E] 5

  v_season_draft uuid := 'c2443178-db2d-440e-ba0a-ea2e288c152d'; -- Draft Season
  v_season_mh    uuid := 'ffff0000-0000-0000-0000-0000000000f2'; -- Mathis Hosts
  v_season_dh    uuid := 'e5de3294-b077-4392-8a59-682cc5d8083c'; -- Demo Hosts

  v_opens    timestamptz := now() - interval '7 days';
  v_closes   timestamptz := now() + interval '14 days';
  v_start    timestamptz := now() + interval '21 days';
  v_end      timestamptz := now() + interval '23 days';
  v_cutoff_ok   timestamptz := now() + interval '10 days';
  v_cutoff_past timestamptz := now() - interval '7 days';

  v_n int;
BEGIN
  -- ---------------------------------------------------------------- asserts
  SELECT id INTO v_cancel FROM tournaments WHERE name = '[PAYE2E] 8 - Tiers organise';
  SELECT id INTO v_late   FROM tournaments WHERE name = '[PAYE2E] 5 - Date limite depassee';
  IF v_cancel IS NULL OR v_late IS NULL THEN
    RAISE EXCEPTION 'missing [PAYE2E] fixture (8 and/or 5)';
  END IF;

  SELECT count(*) INTO v_n FROM unnest(ARRAY[v_draft, v_organize, v_live, v_absorbs, v_invited]) t(id)
  WHERE NOT EXISTS (SELECT 1 FROM tournaments WHERE tournaments.id = t.id);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% [PAYUI] fixture id(s) no longer resolve', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM seasons WHERE id = v_season_draft)
     OR NOT EXISTS (SELECT 1 FROM seasons WHERE id = v_season_mh)
     OR NOT EXISTS (SELECT 1 FROM seasons WHERE id = v_season_dh) THEN
    RAISE EXCEPTION 'a paid-league season id no longer resolves';
  END IF;

  -- ------------------------------------------------------------ tournaments
  -- Same date rot as the jdl suite: registration had closed and the refund
  -- cutoffs had passed, which would make the 100/50/0 checks all read $0.
  UPDATE tournaments SET
    registration_opens_at  = v_opens,
    registration_closes_at = v_closes,
    start_date             = v_start,
    end_date               = v_end,
    refund_cutoff_at       = CASE WHEN refund_cutoff_at IS NULL THEN NULL ELSE v_cutoff_ok END
  WHERE name LIKE '[PAYUI]%' OR id IN (v_cancel, v_late);

  -- §4.4's fixture: refund window closed, registration still open.
  UPDATE tournaments SET refund_cutoff_at = v_cutoff_past WHERE id = v_late;

  UPDATE tournaments SET status = 'registration_open', cancelled_at = NULL, cancelled_reason = NULL
  WHERE (name LIKE '[PAYUI]%' OR id IN (v_cancel, v_late)) AND id <> v_draft;

  -- §1.1 needs an unpublished paid tournament to refuse to publish.
  UPDATE tournaments SET status = 'draft', cancelled_at = NULL, cancelled_reason = NULL
  WHERE id = v_draft;

  -- --------------------------------------------------------- registrations
  -- §4.1: consumed on 2026-08-03 after four failed/cancelled attempts. Drop the
  -- registration and every ledger row behind it.
  DELETE FROM lt_registration_payment
  WHERE tournament_registration_id IN (
    SELECT id FROM tournament_registrations WHERE tournament_id = v_live AND user_id = v_demo
  );
  DELETE FROM tournament_registrations WHERE tournament_id = v_live AND user_id = v_demo;

  -- Jean paid and withdrew here by mistake on 2026-08-04 (this public fixture
  -- is the mirror of his own [PAYUI-JDL] one and shows up in his directory).
  -- The charge and its refund both went through; only the stray row is removed.
  DELETE FROM lt_registration_payment
  WHERE tournament_registration_id IN (
    SELECT id FROM tournament_registrations WHERE tournament_id = v_absorbs AND user_id = v_jdl
  );
  DELETE FROM tournament_registrations WHERE tournament_id = v_absorbs AND user_id = v_jdl;

  -- §4.5.2: pending invite with NO ledger row is what makes it pay-to-confirm.
  DELETE FROM lt_registration_payment
  WHERE tournament_registration_id IN (
    SELECT id FROM tournament_registrations WHERE tournament_id = v_invited AND user_id = v_demo
  );
  UPDATE tournament_registrations SET
    status = 'pending', withdrawn_at = NULL, approved_at = NULL
  WHERE tournament_id = v_invited AND user_id = v_demo;

  -- §4.4: he withdrew after the cutoff (correctly, $0). Put the paid
  -- registration back; its pi_sim ledger row was never refunded.
  UPDATE tournament_registrations SET
    status = 'registered', withdrawn_at = NULL, approved_at = registered_at
  WHERE tournament_id = v_late AND user_id = v_demo;

  -- ---------------------------------------------------------------- leagues
  -- §5.1's season is still a draft (not consumed), but its start date had gone
  -- past, which would fail the open for the wrong reason.
  UPDATE seasons SET
    status = 'draft', start_date = (v_start)::date, end_date = (v_start + interval '90 days')::date,
    closed_at = NULL, cancelled_at = NULL, cancelled_reason = NULL
  WHERE id = v_season_draft;

  -- §5.2: demo must be a league member of Mathis Hosts but NOT enrolled in the
  -- season. Clear any enrollment, keep the membership.
  DELETE FROM lt_registration_payment WHERE season_id = v_season_mh AND payer_user_id = v_demo;
  DELETE FROM season_rankings WHERE season_id = v_season_mh AND user_id = v_demo;
  DELETE FROM season_members WHERE season_id = v_season_mh AND user_id = v_demo;

  IF NOT EXISTS (
    SELECT 1 FROM league_members
    WHERE league_id = (SELECT league_id FROM seasons WHERE id = v_season_mh)
      AND user_id = v_demo AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'demo lost his Mathis Hosts league membership — §5.2 needs it';
  END IF;

  UPDATE seasons SET
    start_date = (now() - interval '7 days')::date,
    end_date   = (now() + interval '90 days')::date
  WHERE id IN (v_season_mh, v_season_dh);
END $$;

SET session_replication_role = DEFAULT;
