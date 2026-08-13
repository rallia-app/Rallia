-- Reset Jean's paid-payments test fixtures (staging) back to the start state
-- described in the paid-payments test guide (Google Drive).
--
-- Rerun this before each pass of the protocol: the scenarios are one-shot
-- (publishing, cancelling, paying, enrolling all consume their fixture) and the
-- dates rot, so a second pass on an untouched database tests nothing.
--
-- Tester: jdl.sonkin+10@gmail.com (Jose Caroon, 82928ca5-7406-4cf2-984f-957fce8a2d96)
-- Targets he pays into are organized by demo@rallia.ca and stay untouched here.
-- Runs under replica role so restoring rows does not push notify anyone.
--
-- Scope: Jean's suite only ([PAYUI-JDL]%, [PAYE2E] 6, [PAYE2E] Ligue payante,
-- [SEED] Paid League - JDL Hosts, [SEED] Paid League — Demo Hosts). The demo
-- tester's [PAYUI]% mirror is deliberately not touched.

SET session_replication_role = replica;

DO $$
DECLARE
  v_jdl   uuid := '82928ca5-7406-4cf2-984f-957fce8a2d96';  -- jdl.sonkin+10@gmail.com
  v_demo  uuid := '5e0c481b-5360-490e-8576-d1bab41bcbeb';  -- demo@rallia.ca

  -- Fixture ids (fixed at seed time, asserted below)
  v_draft     uuid := 'dddd0000-0000-0000-0000-0000000000d2';  -- Draft a publier
  v_organize  uuid := 'bbbb0000-0000-0000-0000-0000000000b5';  -- You organize
  v_live      uuid := 'bbbb0000-0000-0000-0000-0000000000b6';  -- LIVE register + pay
  v_invited   uuid := 'bbbb0000-0000-0000-0000-0000000000b9';  -- You are invited
  v_cutoff    uuid := 'bbbb0000-0000-0000-0000-0000000000ba';  -- Refund cutoff passed
  v_cancel    uuid;                                            -- [PAYE2E] 6
  v_reg_inv   uuid := 'cccc0000-0000-0000-0000-0000000000b9';
  v_reg_cut   uuid := 'cccc0000-0000-0000-0000-0000000000ba';

  v_season_e2e  uuid := '05e42736-7092-426c-80b6-305a28a8f53d'; -- [PAYE2E] Ligue payante
  v_season_demo uuid := 'e5de3294-b077-4392-8a59-682cc5d8083c'; -- Demo Hosts season
  v_season_jdl  uuid := 'eeee0000-0000-0000-0000-0000000000e2'; -- JDL Hosts season

  -- Dates, relative to the run so the fixtures never age out again
  v_opens    timestamptz := now() - interval '7 days';
  v_closes   timestamptz := now() + interval '14 days';
  v_start    timestamptz := now() + interval '21 days';
  v_end      timestamptz := now() + interval '23 days';
  v_cutoff_ok   timestamptz := now() + interval '10 days';
  v_cutoff_past timestamptz := now() - interval '7 days';

  v_n int;
BEGIN
  -- ---------------------------------------------------------------- asserts
  -- Fail before touching anything if a fixture was renamed or deleted.
  SELECT id INTO v_cancel FROM tournaments WHERE name = '[PAYE2E] 6 - Annulation et remboursement';
  IF v_cancel IS NULL THEN
    RAISE EXCEPTION 'missing fixture: [PAYE2E] 6 - Annulation et remboursement';
  END IF;

  SELECT count(*) INTO v_n FROM unnest(ARRAY[v_draft, v_organize, v_live, v_invited, v_cutoff]) t(id)
  WHERE NOT EXISTS (SELECT 1 FROM tournaments WHERE tournaments.id = t.id);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% [PAYUI-JDL] fixture id(s) no longer resolve', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM seasons WHERE id = v_season_e2e)
     OR NOT EXISTS (SELECT 1 FROM seasons WHERE id = v_season_demo)
     OR NOT EXISTS (SELECT 1 FROM seasons WHERE id = v_season_jdl) THEN
    RAISE EXCEPTION 'a paid-league season id no longer resolves';
  END IF;

  -- ------------------------------------------------------- §1.1 + §2 Stripe
  -- Jean's account completed onboarding on 2026-08-04, and re-running hosted
  -- onboarding on a complete account is a no-op (Stripe fires no
  -- account.updated, nothing syncs). Dropping the mirror row sends the Versements
  -- row back to "Action requise": player-stripe-onboard finds no row and creates
  -- a brand-new Express account, so the whole flow is walkable again. The old
  -- acct_ is left orphaned in the sandbox, which nothing reads.
  DELETE FROM player_stripe_account WHERE player_id = v_jdl;

  -- ------------------------------------------------------------ tournaments
  -- Push every date forward first: several fixtures had aged into
  -- registration_closed and the refund cutoffs had passed, which would have made
  -- the 100% / 50% / 0% refund checks in §4.5 all announce $0.
  UPDATE tournaments SET
    registration_opens_at  = v_opens,
    registration_closes_at = v_closes,
    start_date             = v_start,
    end_date               = v_end,
    refund_cutoff_at       = CASE WHEN refund_cutoff_at IS NULL THEN NULL ELSE v_cutoff_ok END
  WHERE name LIKE '[PAYUI-JDL]%' OR id = v_cancel OR id = v_draft;

  -- ...except this one, whose entire point is a refund window that has closed
  -- while registration is still open (§4.4).
  UPDATE tournaments SET refund_cutoff_at = v_cutoff_past WHERE id = v_cutoff;

  -- Everything Jean registers into or withdraws from must be open. Draft a
  -- publier is excluded: it is the one fixture that must stay unpublished.
  UPDATE tournaments SET status = 'registration_open', cancelled_at = NULL, cancelled_reason = NULL
  WHERE (name LIKE '[PAYUI-JDL]%' OR id = v_cancel) AND id <> v_draft;

  -- §1.1 needs an unpublished paid tournament to refuse to publish.
  UPDATE tournaments SET status = 'draft', cancelled_at = NULL, cancelled_reason = NULL
  WHERE id = v_draft;

  -- --------------------------------------------------------- registrations
  -- §4.1: he paid for real ($15.86, pi_3U0X2f...). Drop the registration and its
  -- ledger row so the fixture is "pas inscrit" again. The sandbox charge stays
  -- at Stripe in demo's balance, which no scenario reads.
  DELETE FROM lt_registration_payment
  WHERE tournament_registration_id IN (
    SELECT id FROM tournament_registrations WHERE tournament_id = v_live AND user_id = v_jdl
  );
  DELETE FROM tournament_registrations WHERE tournament_id = v_live AND user_id = v_jdl;

  -- §4.5.2: the invitation must be pending again with NO ledger row — that is
  -- what makes it a pay-to-confirm invite. He accepted and paid on 2026-08-04
  -- (one cancelled + one succeeded intent), then withdrew.
  DELETE FROM lt_registration_payment WHERE tournament_registration_id = v_reg_inv;
  UPDATE tournament_registrations SET
    status = 'pending', withdrawn_at = NULL, approved_at = NULL, invited_by = v_demo
  WHERE id = v_reg_inv;

  -- §4.4: he withdrew after the cutoff (correctly, $0 refunded). Put the paid
  -- registration back; its pi_sim ledger row was never refunded so it still fits.
  UPDATE tournament_registrations SET
    status = 'registered', withdrawn_at = NULL, approved_at = registered_at
  WHERE id = v_reg_cut;

  -- ---------------------------------------------------------------- leagues
  -- §5.1 opens this season; it was consumed on 2026-08-04. Dates go forward too
  -- so opening a season whose start has passed is not what fails.
  UPDATE seasons SET
    status = 'draft', start_date = (v_start)::date, end_date = (v_start + interval '90 days')::date,
    closed_at = NULL, cancelled_at = NULL, cancelled_reason = NULL,
    refund_cutoff_at = v_cutoff_ok
  WHERE id = v_season_e2e;

  -- §5.2: he enrolled and paid for real ($42.30). Remove the enrollment, its
  -- ledger row and his standings row so the season is back to the 5 paid fakes.
  DELETE FROM lt_registration_payment WHERE season_id = v_season_demo AND payer_user_id = v_jdl;
  DELETE FROM season_rankings WHERE season_id = v_season_demo AND user_id = v_jdl;
  DELETE FROM season_members WHERE season_id = v_season_demo AND user_id = v_jdl;

  -- He stays a plain league member — §5.2 is explicit that the season is what
  -- gets paid for, not the league.
  IF NOT EXISTS (
    SELECT 1 FROM league_members
    WHERE league_id = (SELECT league_id FROM seasons WHERE id = v_season_demo)
      AND user_id = v_jdl AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'jdl lost his Demo Hosts league membership — §5.2 needs it';
  END IF;

  -- Keep both open seasons in the future so §5.2/§5.3 stay playable.
  UPDATE seasons SET
    start_date = (now() - interval '7 days')::date,
    end_date   = (now() + interval '90 days')::date
  WHERE id IN (v_season_demo, v_season_jdl);
END $$;

SET session_replication_role = DEFAULT;
