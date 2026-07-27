-- ============================================================================
-- Seed staging with the PAID end-to-end set
--
-- Target: rallia-staging (ahbaeewecdeguxtxtvhr)
-- Prefix: "[PAYE2E] " — its own batch, never touches "[SEED-T] ", "[SEED-S] ",
-- "[SEED] ", "[PAYUI] ", "[JDL " or the live "Série 1" rows.
--
-- WHY THIS EXISTS, AND HOW IT DIFFERS FROM "[PAYUI] "
-- The "[PAYUI] " and "[SEED] Paid League" batches were seeded with FAKE ledger
-- rows (stripe ids `pi_seed_…` / `ch_seed_…`) so the paid UI could be looked at
-- without paying. That makes them unusable for a real run: cancelling or
-- closing one sends `lt-settle-event-payments` after Stripe intents that do not
-- exist. This batch carries **zero ledger rows**. Every payment on it comes
-- from a real test-mode card, so charge, refund, cancel-refund and payout can
-- all be exercised for real.
--
-- PREREQUISITE
-- `lt-create-registration-payment` builds a destination charge with
-- `on_behalf_of` + `transfer_data.destination`, which Stripe refuses unless the
-- organizer's connected account has card_payments + transfers active. As of
-- 2026-07-26 no account on staging does (`charges_enabled = false`,
-- `details_submitted = false` on all three). The organizer must complete Stripe
-- Express onboarding first, through the app's payout setup. Fixture 8 also
-- needs lefrancmathis@gmail.com onboarded; skip it if only jdl is set up.
--
-- Organizer: jdl.sonkin@gmail.com on everything except fixture 8.
-- Test card: 4242 4242 4242 4242, any future expiry, any CVC, any postal code.
--
-- Run:  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/tournaments/seed-paid-e2e-staging.sql
--   or  paste the body into Supabase MCP execute_sql WITHOUT BEGIN;/COMMIT;.
--
-- CLEANUP IS DELIBERATELY CONSERVATIVE: re-running skips any fixture that has
-- a real payment attached, so a completed run is never silently wiped. To force
-- a reset, refund through the app first, then delete by hand.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Cleanup: only fixtures with NO real payment history
-- --------------------------------------------------------------------------
DO $$
DECLARE v_kept integer;
BEGIN
  SELECT count(*) INTO v_kept
    FROM tournaments t
   WHERE t.name LIKE '[PAYE2E] %'
     AND EXISTS (SELECT 1 FROM tournament_registrations r
                   JOIN lt_registration_payment p ON p.tournament_registration_id = r.id
                  WHERE r.tournament_id = t.id);
  IF v_kept > 0 THEN
    RAISE NOTICE '[PAYE2E] keeping % tournament(s) that carry real payment rows', v_kept;
  END IF;
END $$;

DELETE FROM leagues_tournaments_audit
 WHERE scope = 'tournament'
   AND entity_id IN (
     SELECT t.id FROM tournaments t
      WHERE t.name LIKE '[PAYE2E] %'
        AND NOT EXISTS (SELECT 1 FROM tournament_registrations r
                          JOIN lt_registration_payment p ON p.tournament_registration_id = r.id
                         WHERE r.tournament_id = t.id));

DELETE FROM tournaments t
 WHERE t.name LIKE '[PAYE2E] %'
   AND NOT EXISTS (SELECT 1 FROM tournament_registrations r
                     JOIN lt_registration_payment p ON p.tournament_registration_id = r.id
                    WHERE r.tournament_id = t.id);

DELETE FROM leagues l
 WHERE l.name LIKE '[PAYE2E] %'
   AND NOT EXISTS (SELECT 1 FROM seasons s
                     JOIN lt_registration_payment p ON p.season_id = s.id
                    WHERE s.league_id = l.id);

-- --------------------------------------------------------------------------
-- Helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.seed_set_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END; $$ LANGUAGE plpgsql;

-- Direct INSERT: tournament_create rate-limits a non-admin to 5 per 24h, and
-- the fee columns are easier to set exactly here.
CREATE OR REPLACE FUNCTION pg_temp.e2e_new(
  p_org uuid, p_name text, p_sport uuid, p_desc text,
  p_fee_cents integer,
  p_fee_payer fee_payer_enum DEFAULT 'player_pays',
  p_refund refund_policy_kind_enum DEFAULT 'full',
  p_partial_bps integer DEFAULT NULL,
  p_cutoff_in interval DEFAULT '7 days',
  p_facility uuid DEFAULT NULL, p_venue text DEFAULT NULL,
  p_start_in interval DEFAULT '21 days', p_reg_closes_in interval DEFAULT '10 days'
) RETURNS tournaments AS $$
DECLARE v_row tournaments;
BEGIN
  INSERT INTO tournaments (
    name, sport_id, max_participants, start_date, end_date, description,
    visibility, registration_mode, bracket_type, match_format, entry_format,
    facility_id, venue_name, registration_opens_at, registration_closes_at,
    organizer_id, status,
    entry_fee_cents, currency, fee_payer, payout_timing,
    refund_policy_kind, refund_partial_bps, refund_cutoff_at
  ) VALUES (
    p_name, p_sport, 4, now() + p_start_in, now() + p_start_in + interval '6 hours', p_desc,
    'public', 'open', 'single_elimination', 'two_of_three', 'singles',
    p_facility, p_venue,
    LEAST(now() - interval '2 days', now() + p_reg_closes_in - interval '1 day'),
    now() + p_reg_closes_in, p_org, 'registration_open',
    p_fee_cents, 'CAD', p_fee_payer, 'hold_until_event_end',
    p_refund, p_partial_bps, now() + p_cutoff_in
  ) RETURNING * INTO v_row;
  RETURN v_row;
END; $$ LANGUAGE plpgsql;

-- --------------------------------------------------------------------------
-- Seed
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_tennis uuid; v_facility uuid; v_jdl uuid; v_mathis uuid;
  v_p uuid[]; v_t tournaments; v_league leagues; v_season seasons; i integer;
BEGIN
  SELECT id INTO v_tennis   FROM sport WHERE name = 'tennis';
  SELECT id INTO v_facility FROM facility WHERE is_active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_jdl      FROM auth.users WHERE email = 'jdl.sonkin@gmail.com';
  SELECT id INTO v_mathis   FROM auth.users WHERE email = 'lefrancmathis@gmail.com';
  IF v_jdl IS NULL THEN
    RAISE EXCEPTION 'jdl.sonkin@gmail.com not found on this database';
  END IF;

  SELECT array_agg(id) INTO v_p FROM (
    SELECT u.id FROM auth.users u JOIN player_sport ps ON ps.player_id = u.id
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.sport_id = v_tennis AND ps.is_active
     ORDER BY u.id LIMIT 4) s;

  -- 1. The basic charge. Player pays the fee on top of the entry.
  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE name = '[PAYE2E] 1 - Payer maintenant') THEN
    PERFORM pg_temp.e2e_new(v_jdl, '[PAYE2E] 1 - Payer maintenant', v_tennis,
      '25 $, joueur paie les frais, remboursement complet. Inscrivez-vous et payez avec 4242 4242 4242 4242.',
      2500, 'player_pays', 'full', NULL, '7 days', v_facility, 'Club de Tennis de Monkland');
  END IF;

  -- 2. Withdraw before the cutoff on a partial policy: half the entry back,
  --    service fee never returned.
  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE name = '[PAYE2E] 2 - Remboursement 50%') THEN
    PERFORM pg_temp.e2e_new(v_jdl, '[PAYE2E] 2 - Remboursement 50%', v_tennis,
      '30 $, remboursement partiel 50 %. Payez puis desistez-vous avant la date limite.',
      3000, 'player_pays', 'partial', 5000, '7 days', v_facility, 'Parc Jeanne-Mance');
  END IF;

  -- 3. No-refund policy: withdrawing returns nothing.
  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE name = '[PAYE2E] 3 - Aucun remboursement') THEN
    PERFORM pg_temp.e2e_new(v_jdl, '[PAYE2E] 3 - Aucun remboursement', v_tennis,
      '20 $, aucun remboursement. Payez puis desistez-vous: rien ne doit revenir.',
      2000, 'player_pays', 'none', NULL, '7 days', v_facility, 'Stade IGA');
  END IF;

  -- 4. Organizer absorbs: the player is charged the entry only.
  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE name = '[PAYE2E] 4 - Organisateur absorbe') THEN
    PERFORM pg_temp.e2e_new(v_jdl, '[PAYE2E] 4 - Organisateur absorbe', v_tennis,
      '40 $, organisateur absorbe les frais. Le joueur ne doit payer que 40 $ pile.',
      4000, 'organizer_absorbs', 'full', NULL, '7 days', v_facility, 'Tennis 13');
  END IF;

  -- 5. Cutoff already passed: a full policy still refunds nothing.
  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE name = '[PAYE2E] 5 - Date limite depassee') THEN
    PERFORM pg_temp.e2e_new(v_jdl, '[PAYE2E] 5 - Date limite depassee', v_tennis,
      '25 $, politique « complet » mais la date limite est passee: le desistement ne rembourse rien.',
      2500, 'player_pays', 'full', NULL, '-1 day', v_facility, 'Parc Jarry');
  END IF;

  -- 6. Organizer cancels: lt_cancel_refund_candidates refunds every entry.
  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE name = '[PAYE2E] 6 - Annulation et remboursement') THEN
    PERFORM pg_temp.e2e_new(v_jdl, '[PAYE2E] 6 - Annulation et remboursement', v_tennis,
      '25 $. Payez, puis annulez le tournoi: le cron doit rembourser l''entree a tout le monde.',
      2500, 'player_pays', 'full', NULL, '7 days', v_facility, 'Parc La Fontaine');
  END IF;

  -- 7. The payout leg. Registration is open but the event dates are already in
  --    the past, so once it is COMPLETED the `end_date + 24h` release window is
  --    immediately satisfied and the hourly cron pays out on its next run.
  --    A second entrant is needed for a bracket, so one fake is inserted while
  --    the tournament is still free (the payment gate reads entry_fee_cents at
  --    INSERT time) and the fee is applied straight after. That row is
  --    deliberately unpaid: it only exists so the draw has two players.
  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE name = '[PAYE2E] 7 - Versement au createur') THEN
    v_t := pg_temp.e2e_new(v_jdl, '[PAYE2E] 7 - Versement au createur', v_tennis,
      '15 $. Payez, fermez les inscriptions, generez le tableau, entrez le resultat. Le tournoi se termine et le versement part au prochain cron horaire.',
      0, 'player_pays', 'full', NULL, '7 days', v_facility, 'Centre sportif de Verdun',
      p_start_in => '-3 days', p_reg_closes_in => '7 days');
    INSERT INTO tournament_registrations (tournament_id, user_id, status, registered_at, approved_at)
    VALUES (v_t.id, v_p[1], 'registered', now() - interval '1 day', now() - interval '1 day');
    UPDATE tournaments SET entry_fee_cents = 1500 WHERE id = v_t.id;
  END IF;

  -- 8. Paying a THIRD-PARTY organizer. Needs Mathis onboarded as well.
  IF v_mathis IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM tournaments WHERE name = '[PAYE2E] 8 - Tiers organise') THEN
    PERFORM pg_temp.e2e_new(v_mathis, '[PAYE2E] 8 - Tiers organise', v_tennis,
      '25 $, organise par quelqu''un d''autre. Exige que CET organisateur ait complete son compte Stripe.',
      2500, 'player_pays', 'full', NULL, '7 days', v_facility, 'Club de Tennis de Monkland');
  END IF;

  -- 9. Paid SEASON, left in draft so the open-the-season step is part of the
  --    run. Opening it, enrolling and paying are all done from the app.
  IF NOT EXISTS (SELECT 1 FROM leagues WHERE name = '[PAYE2E] Ligue payante') THEN
    PERFORM pg_temp.seed_set_user(v_jdl);
    v_league := league_create(
      p_name => '[PAYE2E] Ligue payante', p_sport_id => v_tennis,
      p_description => 'Saison payante en brouillon. Ouvrez-la, inscrivez-vous, payez, puis testez le retrait et le remboursement.',
      p_visibility => 'public', p_join_mode => 'open',
      p_facility_id => v_facility, p_venue_name => 'Parc Jarry');
    FOR i IN 1..4 LOOP
      INSERT INTO league_members(league_id, user_id, role, status, approved_at)
      VALUES (v_league.id, v_p[i], 'member', 'active', now())
      ON CONFLICT (league_id, user_id) DO NOTHING;
    END LOOP;
    PERFORM pg_temp.seed_set_user(v_jdl);
    PERFORM season_create(
      p_league_id => v_league.id, p_name => 'Saison payante E2E',
      p_start_date => current_date, p_end_date => current_date + 90,
      p_entry_fee_cents => 3000, p_fee_payer => 'player_pays',
      p_payout_timing => 'hold_until_event_end',
      p_refund_policy_kind => 'partial', p_refund_partial_bps => 5000,
      p_refund_cutoff_at => now() + interval '7 days');
  END IF;

  RAISE NOTICE 'Seeded % [PAYE2E] tournaments and % league(s)',
    (SELECT count(*) FROM tournaments WHERE name LIKE '[PAYE2E] %'),
    (SELECT count(*) FROM leagues WHERE name LIKE '[PAYE2E] %');
END $$;

COMMIT;
