-- ============================================================================
-- Seed staging with a COMPLETE league test suite (free + paid flows)
--
-- Target: rallia-staging (ahbaeewecdeguxtxtvhr)
-- Idempotent: removes prior rows whose name starts with "[SEED] " and the
-- seeded payout accounts (stripe_account_id LIKE 'acct_seed_%'). Never touches
-- the "[JDL " test-guide fixtures.
--
-- Participants are drawn from the @fake-rallia.com pool so no real user is
-- notified or cluttered.
--
-- Two real humans hold positions here, and which one matters:
--   lefrancmathis@gmail.com  ORGANIZES the "Mathis Hosts" / paid fixtures.
--   jdl.sonkin@gmail.com     is the TESTER the leagues & tournaments guide
--                            addresses, so every "you are a member / you have an
--                            invitation / you belong to a closed league"
--                            position must include him.
--
-- This seed predates the guide handing the tester role to jdl, and the member
-- and invitee positions still pointed only at Mathis. That produced three
-- false bug reports on the 2026-07-30 pass ("je n'ai pas trouve cette ligue",
-- "je n'ai pas vu d'invitation a accepter") against fixtures that were real but
-- assigned to the other account. Both are seeded now.
--
-- Run:  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/seed-leagues-staging.sql
--   or  npm run db:seed:leagues:staging
--   or  paste the body (helpers + DO block + verify) into Supabase MCP execute_sql.
--
-- Paid-flow notes (staging has no charges_enabled account, and this session's
-- money-hardening migrations are not deployed):
--   * Paid rosters are seeded with succeeded ledger rows carrying FAKE Stripe
--     ids. While a season stays OPEN the settle cron never touches them (payout
--     needs closed, refund needs cancelled), so no real Stripe call happens.
--     Do NOT cancel or close a seeded paid season, or the cron will keep trying
--     to refund/pay out fake intents (harmless log noise) — re-run this seed to
--     clear it. The "[SEED] Paid League — Mathis Hosts" season is the one to use
--     for cancel testing only after emptying it, or just accept the log noise.
--   * Real end-to-end payment (tapping Join and paying) needs charges_enabled on
--     the organizer's Stripe account, which no staging account has yet.
--   * Organizer removal auto-refund (disqualified + candidate leg) needs the
--     20260721 migrations deployed to staging; until then removal just withdraws
--     the member. Everything else works on current staging.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Cleanup previous [SEED] batch (leave [JDL ...] untouched)
-- --------------------------------------------------------------------------
DELETE FROM lt_registration_payment
 WHERE season_id IN (SELECT s.id FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.name LIKE '[SEED] %');
DELETE FROM season_rankings
 WHERE season_id IN (SELECT s.id FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.name LIKE '[SEED] %');
DELETE FROM season_members
 WHERE season_id IN (SELECT s.id FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.name LIKE '[SEED] %');
DELETE FROM seasons
 WHERE league_id IN (SELECT id FROM leagues WHERE name LIKE '[SEED] %');
DELETE FROM league_members
 WHERE league_id IN (SELECT id FROM leagues WHERE name LIKE '[SEED] %');
DELETE FROM leagues_tournaments_audit
 WHERE scope='league' AND entity_id IN (SELECT id FROM leagues WHERE name LIKE '[SEED] %');
DELETE FROM leagues WHERE name LIKE '[SEED] %';
DELETE FROM player_stripe_account WHERE stripe_account_id LIKE 'acct_seed_%';

-- --------------------------------------------------------------------------
-- Helpers (impersonate via JWT GUC; trigger side-effects suppressed below)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.seed_set_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.seed_create_league(
  p_organizer uuid, p_name text, p_sport_id uuid,
  p_visibility tournament_visibility DEFAULT 'public',
  p_join_mode tournament_registration_mode DEFAULT 'open',
  p_description text DEFAULT NULL, p_venue_name text DEFAULT NULL, p_facility_id uuid DEFAULT NULL,
  p_min_rating numeric DEFAULT NULL, p_max_rating numeric DEFAULT NULL, p_min_rep smallint DEFAULT NULL,
  p_level text DEFAULT NULL, p_capacity integer DEFAULT NULL, p_waitlist boolean DEFAULT false,
  p_status league_status DEFAULT 'active'
) RETURNS leagues AS $$
DECLARE v_league leagues;
BEGIN
  PERFORM pg_temp.seed_set_user(p_organizer);
  SELECT * INTO v_league FROM league_create(
    p_name=>p_name, p_sport_id=>p_sport_id, p_description=>p_description,
    p_visibility=>p_visibility, p_join_mode=>p_join_mode, p_facility_id=>p_facility_id,
    p_venue_name=>p_venue_name, p_min_rating=>p_min_rating, p_max_rating=>p_max_rating,
    p_min_reputation=>p_min_rep);
  UPDATE leagues SET level=p_level, member_capacity=p_capacity,
    waitlist_enabled=COALESCE(p_waitlist,false), status=p_status
   WHERE id=v_league.id RETURNING * INTO v_league;
  RETURN v_league;
END; $$ LANGUAGE plpgsql;

-- Add an ACTIVE league member directly (bypasses join/approval; replica role
-- suppresses the membership-notification trigger).
CREATE OR REPLACE FUNCTION pg_temp.seed_active_member(p_league uuid, p_user uuid) RETURNS void AS $$
BEGIN
  INSERT INTO league_members(league_id, user_id, role, status, approved_at)
  VALUES (p_league, p_user, 'member', 'active', now())
  ON CONFLICT (league_id, user_id) DO UPDATE SET status='active', approved_at=now();
END; $$ LANGUAGE plpgsql;

-- Enrol a member into a PAID season the way the webhook does — a succeeded
-- ledger row then enrolled — so the payment gate is satisfied (we can't suppress
-- it: the MCP role can't set session_replication_role). The Stripe ids are fake:
-- while the season stays OPEN the settle cron never touches these rows (release
-- needs closed, refund needs cancelled), so no real Stripe call is ever made.
-- Only cancelling/closing a season with these rows makes the cron attempt a
-- refund/payout on a fake intent (harmless log noise) — so seeded paid rosters
-- live only in OPEN seasons the tester is not meant to close.
CREATE OR REPLACE FUNCTION pg_temp.seed_pay(p_season uuid, p_user uuid, p_entry int, p_org uuid) RETURNS void AS $$
DECLARE v_mid uuid; v_fee int; v_tax int;
BEGIN
  v_fee := round(p_entry * 0.05);               -- straight 5%, no flat add-on
  v_tax := round(v_fee * 0.14975);              -- GST + QST on the fee
  INSERT INTO season_members(season_id, user_id, status)
  VALUES (p_season, p_user, 'payment_pending')
  ON CONFLICT (season_id, user_id) DO UPDATE SET status='payment_pending' RETURNING id INTO v_mid;
  INSERT INTO lt_registration_payment(season_id, season_user_id, payer_user_id, organizer_id,
    entry_cents, service_fee_cents, fee_tax_cents, organizer_amount_cents, amount_charged_cents,
    currency, fee_payer, payout_timing, status, stripe_payment_intent_id, stripe_charge_id)
  VALUES (p_season, v_mid, p_user, p_org, p_entry, v_fee, v_tax, p_entry, p_entry+v_fee+v_tax,
    'CAD','player_pays','hold_until_event_end','succeeded',
    'pi_seed_'||left(replace(v_mid::text,'-',''),18), 'ch_seed_'||left(replace(v_mid::text,'-',''),18));
  UPDATE season_members SET status='enrolled', enrolled_at=now() WHERE id=v_mid;  -- gate finds the succeeded payment
END; $$ LANGUAGE plpgsql;

-- Give a fake organizer an onboarded payout account so their paid season can
-- open and shows the "Ready" payout state. Fake acct id — real transfers to it
-- would fail, but nothing here moves money.
CREATE OR REPLACE FUNCTION pg_temp.seed_payout(p_user uuid, p_ready boolean DEFAULT true) RETURNS void AS $$
BEGIN
  INSERT INTO player_stripe_account(player_id, stripe_account_id, onboarding_completed,
                                    charges_enabled, payouts_enabled, details_submitted)
  VALUES (p_user, 'acct_seed_'||left(replace(p_user::text,'-',''),16), true, p_ready, p_ready, true)
  ON CONFLICT (player_id) DO NOTHING;  -- never clobber a real onboarded account
END; $$ LANGUAGE plpgsql;

-- Give a season's rankings some win/loss/points variety so standings render.
-- (Window functions aren't allowed in UPDATE SET, so compute in a subquery.)
CREATE OR REPLACE FUNCTION pg_temp.seed_standings(p_season uuid) RETURNS void AS $$
BEGIN
  UPDATE season_rankings sr
     SET wins = x.w, losses = x.l, points = x.w * 10
    FROM (
      SELECT id,
             (1 + (row_number() OVER (ORDER BY user_id))::int % 6) AS w,
             ((row_number() OVER (ORDER BY user_id))::int % 4)     AS l
        FROM season_rankings WHERE season_id = p_season
    ) x
   WHERE sr.id = x.id;
END; $$ LANGUAGE plpgsql;

-- --------------------------------------------------------------------------
-- Seed
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_tennis uuid; v_pickle uuid; v_facility uuid; v_mathis uuid; v_tester uuid;
  v_orgs uuid[]; v_pk uuid[]; v_league leagues; v_member league_members; v_season seasons;
  v_paid_org uuid; v_paid_org2 uuid; v_sid uuid; i integer;
BEGIN
  SELECT id INTO v_tennis FROM sport WHERE name='tennis';
  SELECT id INTO v_pickle FROM sport WHERE name='pickleball';
  SELECT id INTO v_facility FROM facility WHERE is_active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_mathis FROM auth.users WHERE email='lefrancmathis@gmail.com';
  SELECT id INTO v_tester FROM auth.users WHERE email='jdl.sonkin@gmail.com';

  -- Fake-pool organizers/members (no real user gets noise). 12 tennis, 8 pickle.
  SELECT array_agg(id) INTO v_orgs FROM (
    SELECT u.id FROM auth.users u JOIN player_sport ps ON ps.player_id=u.id
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.sport_id=v_tennis AND ps.is_active
     ORDER BY u.id LIMIT 12) t;
  SELECT array_agg(id) INTO v_pk FROM (
    SELECT u.id FROM auth.users u JOIN player_sport ps ON ps.player_id=u.id
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.sport_id=v_pickle AND ps.is_active
     ORDER BY u.id LIMIT 8) t;
  IF v_orgs IS NULL OR array_length(v_orgs,1) < 8 THEN
    RAISE EXCEPTION 'need >=8 fake tennis players, found %', COALESCE(array_length(v_orgs,1),0);
  END IF;
  v_paid_org  := v_orgs[9];   -- fake organizer of the "Mathis Plays" paid league
  v_paid_org2 := v_orgs[10];  -- fake organizer of the closed paid league

  -- ===================== FREE: discovery & membership =====================

  -- 1. Public open ladder — discovery baseline
  v_league := pg_temp.seed_create_league(v_orgs[1], '[SEED] Plateau Open Ladder', v_tennis,
    'public','open','Weekly ladder for all levels. Drop-in friendly.','Club de Tennis de Monkland', v_facility);
  FOR i IN 2..5 LOOP PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[i]); END LOOP;

  -- 2. Public approval + rating gate + one pending (approval UI)
  v_league := pg_temp.seed_create_league(v_orgs[2], '[SEED] NTRP 3.5-4.5 League', v_tennis,
    'public','approval','Intermediate competitive league. Organizer approves each member.',
    'Parc Jeanne-Mance', v_facility, p_min_rating=>3.5, p_max_rating=>4.5, p_level=>'intermediate');
  PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[3]);
  INSERT INTO league_members(league_id,user_id,role,status) VALUES (v_league.id, v_orgs[4], 'member','pending');

  -- 3. Public invite-only + capacity — MATHIS INVITED (accept-invite flow)
  v_league := pg_temp.seed_create_league(v_orgs[3], '[SEED] Elite Invite League', v_tennis,
    'public','invite_only','Invite-only roster, capacity 12.','Centre sportif de Verdun', v_facility,
    p_min_rating=>4.0, p_level=>'advanced', p_capacity=>12, p_waitlist=>true);
  IF v_mathis IS NOT NULL THEN
    INSERT INTO league_members(league_id,user_id,role,status,invited_by)
    VALUES (v_league.id, v_mathis, 'member','pending', v_orgs[3]);
  END IF;
  IF v_tester IS NOT NULL THEN
    INSERT INTO league_members(league_id,user_id,role,status,invited_by)
    VALUES (v_league.id, v_tester, 'member','pending', v_orgs[3])
    ON CONFLICT (league_id, user_id) DO UPDATE
      SET status='pending', invited_by=EXCLUDED.invited_by;
  END IF;

  -- 4. Private open — MATHIS is an active member (My Leagues, private)
  v_league := pg_temp.seed_create_league(v_orgs[4], '[SEED] Friends & Family (Private)', v_tennis,
    'private','open','Private league for testing My Leagues without discovery noise.', NULL, NULL);
  IF v_mathis IS NOT NULL THEN PERFORM pg_temp.seed_active_member(v_league.id, v_mathis); END IF;
  IF v_tester IS NOT NULL THEN PERFORM pg_temp.seed_active_member(v_league.id, v_tester); END IF;

  -- 5. Public open pickleball
  IF v_pk IS NOT NULL AND array_length(v_pk,1) >= 4 THEN
    v_league := pg_temp.seed_create_league(v_pk[1], '[SEED] Anjou Pickleball League', v_pickle,
      'public','open','Social pickleball league, open join.','Complexe sportif d''Anjou', v_facility);
    FOR i IN 2..4 LOOP PERFORM pg_temp.seed_active_member(v_league.id, v_pk[i]); END LOOP;

    -- 6. Public approval pickleball + reputation gate
    PERFORM pg_temp.seed_create_league(v_pk[2], '[SEED] Pickleball Good Sports', v_pickle,
      'public','approval','Requires a minimum reputation score.','Arena Saint-Michel', v_facility,
      p_min_rep=>40::smallint, p_level=>'intermediate');
  END IF;

  -- 7. Paused league
  PERFORM pg_temp.seed_create_league(v_orgs[5], '[SEED] Off-Season Ladder (Paused)', v_tennis,
    'public','open','Paused league — should not accept new joins.','Parc La Fontaine', v_facility, p_status=>'paused');

  -- 8. Closed league. The tester is a member: a closed league is excluded from
  -- discovery by design, so without a membership it is unreachable from every
  -- list and the active/closed split in My Leagues has nothing to show.
  v_league := pg_temp.seed_create_league(v_orgs[6], '[SEED] Archived 2025 League', v_tennis,
    'public','open','Closed league for past-season UI.', NULL, NULL, p_status=>'closed');
  IF v_tester IS NOT NULL THEN PERFORM pg_temp.seed_active_member(v_league.id, v_tester); END IF;

  -- 9. Beginner rating cap
  PERFORM pg_temp.seed_create_league(v_orgs[1], '[SEED] Beginner Tennis Circle', v_tennis,
    'public','open','Max NTRP 3.0 — great for new players.','Club de Tennis Cote-des-Neiges', v_facility,
    p_max_rating=>3.0, p_level=>'beginner');

  -- 10. Advanced min rating
  PERFORM pg_temp.seed_create_league(v_orgs[2], '[SEED] Advanced Singles League', v_tennis,
    'public','approval','Competitive singles — min 4.5 NTRP.','Tennis 13', v_facility,
    p_min_rating=>4.5, p_level=>'advanced');

  -- ===================== FREE: seasons & standings =====================

  -- 11. Open FREE season with members + standings
  v_league := pg_temp.seed_create_league(v_orgs[3], '[SEED] Summer 2026 League', v_tennis,
    'public','open','Open season with rankings seeded.','Club de Tennis de Monkland', v_facility);
  FOR i IN 4..7 LOOP PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[i]); END LOOP;
  PERFORM pg_temp.seed_set_user(v_orgs[3]);
  v_season := season_create(p_league_id=>v_league.id, p_name=>'Ete 2026',
    p_start_date=>current_date, p_end_date=>current_date+120);
  v_season := season_open(v_season.id, v_season.version);
  PERFORM pg_temp.seed_standings(v_season.id);

  -- 12. Draft FREE season (draft -> open flow)
  v_league := pg_temp.seed_create_league(v_orgs[4], '[SEED] Fall League (Draft Season)', v_tennis,
    'public','approval','Open league with a draft season awaiting publish.','Parc Jeanne-Mance', v_facility, p_level=>'open');
  PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[5]);
  PERFORM pg_temp.seed_set_user(v_orgs[4]);
  PERFORM season_create(p_league_id=>v_league.id, p_name=>'Automne 2026',
    p_start_date=>current_date+30, p_end_date=>current_date+150);

  -- 13. MATHIS HOSTS a free league with an open season + standings
  IF v_mathis IS NOT NULL THEN
    v_league := pg_temp.seed_create_league(v_mathis, '[SEED] Mathis Hosts (Free)', v_tennis,
      'public','approval','You organize this one. Test invite, edit, pause/close, sessions, standings.',
      'Club de Tennis de Monkland', v_facility, p_level=>'open');
    FOR i IN 1..5 LOOP PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[i]); END LOOP;
    PERFORM pg_temp.seed_set_user(v_mathis);
    v_season := season_create(p_league_id=>v_league.id, p_name=>'Saison libre',
      p_start_date=>current_date, p_end_date=>current_date+120);
    v_season := season_open(v_season.id, v_season.version);
    PERFORM pg_temp.seed_standings(v_season.id);
  END IF;

  -- ===================== PAID flows =====================

  -- 14. MATHIS HOSTS a PAID league — open paid season, enrolled roster + standings.
  --     Mathis is onboarded (charges_enabled=false) so payout row reads "Action
  --     needed". Tests: paid organizer dashboard, payout row, roster remove,
  --     cancel season, standings. No ledger rows -> cancel/remove are clean.
  IF v_mathis IS NOT NULL THEN
    v_league := pg_temp.seed_create_league(v_mathis, '[SEED] Paid League — Mathis Hosts', v_tennis,
      'public','open','You organize this PAID season ($40, full refund). Test payout row, roster remove, cancel.',
      'Stade IGA', v_facility, p_level=>'intermediate');
    FOR i IN 1..5 LOOP PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[i]); END LOOP;
    PERFORM pg_temp.seed_set_user(v_mathis);
    v_season := season_create(p_league_id=>v_league.id, p_name=>'Saison payante',
      p_start_date=>current_date, p_end_date=>current_date+120,
      p_entry_fee_cents=>4000, p_fee_payer=>'player_pays', p_payout_timing=>'hold_until_event_end',
      p_refund_policy_kind=>'full');
    FOR i IN 1..5 LOOP PERFORM pg_temp.seed_pay(v_season.id, v_orgs[i], 4000, v_mathis); END LOOP;
    v_season := season_open(v_season.id, v_season.version);
    PERFORM pg_temp.seed_standings(v_season.id);
  END IF;

  -- 15. MATHIS PLAYS a PAID league — fake onboarded organizer, open paid season,
  --     Mathis is an active member NOT enrolled. Tests: "Join for $X" CTA, fee
  --     disclosure, roster of enrolled payers, standings.
  PERFORM pg_temp.seed_payout(v_paid_org, true);
  v_league := pg_temp.seed_create_league(v_paid_org, '[SEED] Paid League — Mathis Plays', v_tennis,
    'public','open','Someone else organizes this PAID season ($30). Join it to test the payment sheet.',
    'Parc Jarry', v_facility, p_level=>'intermediate');
  IF v_mathis IS NOT NULL THEN PERFORM pg_temp.seed_active_member(v_league.id, v_mathis); END IF;
  IF v_tester IS NOT NULL THEN PERFORM pg_temp.seed_active_member(v_league.id, v_tester); END IF;
  FOR i IN 1..5 LOOP PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[i]); END LOOP;
  PERFORM pg_temp.seed_set_user(v_paid_org);
  v_season := season_create(p_league_id=>v_league.id, p_name=>'Ligue payante ouverte',
    p_start_date=>current_date, p_end_date=>current_date+120,
    p_entry_fee_cents=>3000, p_fee_payer=>'player_pays', p_payout_timing=>'hold_until_event_end',
    p_refund_policy_kind=>'partial', p_refund_partial_bps=>5000);
  FOR i IN 1..5 LOOP PERFORM pg_temp.seed_pay(v_season.id, v_orgs[i], 3000, v_paid_org); END LOOP;
  v_season := season_open(v_season.id, v_season.version);
  PERFORM pg_temp.seed_standings(v_season.id);

  -- 16. MATHIS HOSTS a PAID DRAFT season (open-the-season flow + refund policy).
  IF v_mathis IS NOT NULL THEN
    v_league := pg_temp.seed_create_league(v_mathis, '[SEED] Paid League — Draft Season', v_tennis,
      'public','approval','You organize this. A PAID season sits in draft ($25, 50% refund) — open it to test the payout gate.',
      'Parc Jeanne-Mance', v_facility, p_level=>'open');
    FOR i IN 1..3 LOOP PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[i]); END LOOP;
    PERFORM pg_temp.seed_set_user(v_mathis);
    PERFORM season_create(p_league_id=>v_league.id, p_name=>'Saison payante (brouillon)',
      p_start_date=>current_date+14, p_end_date=>current_date+134,
      p_entry_fee_cents=>2500, p_fee_payer=>'player_pays', p_payout_timing=>'hold_until_event_end',
      p_refund_policy_kind=>'partial', p_refund_partial_bps=>5000);
  END IF;

  -- 17. CLOSED season with final standings (free — a closed *paid* season would
  --     leave the settle cron trying to pay out fake intents forever).
  v_league := pg_temp.seed_create_league(v_paid_org2, '[SEED] Closed Season League', v_tennis,
    'public','open','A finished season — final standings, no active controls.','Tennis 13', v_facility, p_level=>'intermediate');
  FOR i IN 1..6 LOOP PERFORM pg_temp.seed_active_member(v_league.id, v_orgs[i]); END LOOP;
  PERFORM pg_temp.seed_set_user(v_paid_org2);
  v_season := season_create(p_league_id=>v_league.id, p_name=>'Hiver 2026',
    p_start_date=>current_date, p_end_date=>current_date+90);
  v_season := season_open(v_season.id, v_season.version);
  PERFORM pg_temp.seed_standings(v_season.id);
  v_season := season_close(v_season.id, v_season.version);

  RAISE NOTICE 'Seeded % [SEED] leagues', (SELECT count(*) FROM leagues WHERE name LIKE '[SEED] %');
END $$;

COMMIT;

-- Verify
SELECT l.name, s.name AS sport, l.visibility, l.join_mode, l.status,
  (SELECT count(*) FROM league_members lm WHERE lm.league_id=l.id AND lm.status='active') AS active_members,
  (SELECT count(*) FROM league_members lm WHERE lm.league_id=l.id AND lm.status='pending') AS pending,
  (SELECT string_agg(se.status||CASE WHEN se.entry_fee_cents>0 THEN ' $'||(se.entry_fee_cents/100) ELSE '' END, ', ')
     FROM seasons se WHERE se.league_id=l.id) AS seasons,
  (SELECT bool_or(lm.user_id=(SELECT id FROM auth.users WHERE email='lefrancmathis@gmail.com'))
     FROM league_members lm WHERE lm.league_id=l.id) AS mathis_member,
  (l.organizer_id=(SELECT id FROM auth.users WHERE email='lefrancmathis@gmail.com')) AS mathis_organizes
FROM leagues l JOIN sport s ON s.id=l.sport_id
WHERE l.name LIKE '[SEED] %'
ORDER BY l.name;
