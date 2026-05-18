-- ============================================================================
-- Seed test matches for the reimbursement UX polish
-- Local dev only — DO NOT run against production.
--
-- Creates 4 ENDED, FULL, paid singles tennis matches between:
--   • user1: ce9dd57b-ecd9-4f84-8da3-0f36370c3b59 (lefrancmathis@gmail.com,  Malia)  — payouts_mode='undecided', no Stripe
--   • user2: 2f0d57e8-4dec-4975-8260-c49f88386b9b (lefrancmathis2@gmail.com, Mathis) — payouts_mode='auto',      Stripe onboarded
--
-- match.match_date = YESTERDAY in America/Toronto so all guards pass:
--   hasMatchEnded ✓  isFull (2/2) ✓  !isCourtFree ✓  estimated_cost > 0 ✓  cost_split='split_equal' ✓
--
-- Re-running is safe: deletes by id first.
-- ============================================================================

BEGIN;

-- Pull constants into a temporary table so they're available across statements
CREATE TEMP TABLE seed_conf ON COMMIT DROP AS
SELECT
  'eec0576b-7150-48ba-a9ba-f2613b542d0e'::uuid    AS sport_tennis,
  'e670f305-6c28-4774-ab29-699dcbcbf45d'::uuid    AS sport_pickleball,
  'aaaad640-93fe-4157-9fa4-f9fb2aa600a8'::uuid    AS facility_id,
  (CURRENT_DATE - INTERVAL '1 day')::date         AS match_date,
  '14:00:00'::time                                AS start_time,
  '15:30:00'::time                                AS end_time,
  'America/Toronto'::text                         AS tz,
  'ce9dd57b-ecd9-4f84-8da3-0f36370c3b59'::uuid    AS user1, -- Malia
  '2f0d57e8-4dec-4975-8260-c49f88386b9b'::uuid    AS user2; -- Mathis

-- Hardcoded match ids → re-running is idempotent
DELETE FROM pending_host_transfer WHERE match_participant_id IN (
  SELECT id FROM match_participant WHERE match_id IN (
    '11111111-aaaa-aaaa-aaaa-000000000001',
    '11111111-aaaa-aaaa-aaaa-000000000002',
    '11111111-aaaa-aaaa-aaaa-000000000003',
    '11111111-aaaa-aaaa-aaaa-000000000004'
  )
);
DELETE FROM match_participant WHERE match_id IN (
  '11111111-aaaa-aaaa-aaaa-000000000001',
  '11111111-aaaa-aaaa-aaaa-000000000002',
  '11111111-aaaa-aaaa-aaaa-000000000003',
  '11111111-aaaa-aaaa-aaaa-000000000004'
);
DELETE FROM match WHERE id IN (
  '11111111-aaaa-aaaa-aaaa-000000000001',
  '11111111-aaaa-aaaa-aaaa-000000000002',
  '11111111-aaaa-aaaa-aaaa-000000000003',
  '11111111-aaaa-aaaa-aaaa-000000000004'
);

-- ============================================================================
-- MATCH 1 — Pay Now flow + host undecided prompt + per-row Mark-as-Paid
-- Host=user1 (undecided/no Stripe), Participant=user2, NEITHER paid.
--   user1 view: "How do you want to be paid back?" prompt + 0/1 + Mark-as-Paid per row
--   user2 view: "Your share · $10.00" + Pay Now
-- ============================================================================
INSERT INTO match (id, sport_id, match_date, start_time, end_time, duration,
  format, location_type, facility_id, timezone, visibility, join_mode,
  cost_split_type, is_court_free, estimated_cost, created_by, location_name)
SELECT
  '11111111-aaaa-aaaa-aaaa-000000000001',
  c.sport_tennis, c.match_date, c.start_time, c.end_time, '90',
  'singles', 'facility', c.facility_id, c.tz, 'public', 'direct',
  'split_equal', false, 20.00, c.user1, 'Club de Tennis de Monkland'
FROM seed_conf c;

INSERT INTO match_participant (match_id, player_id, team_number, is_host, status, has_paid, joined_at)
SELECT '11111111-aaaa-aaaa-aaaa-000000000001'::uuid, c.user1, 1, true,  'joined'::match_participant_status_enum, false, now() FROM seed_conf c
UNION ALL
SELECT '11111111-aaaa-aaaa-aaaa-000000000001'::uuid, c.user2, 2, false, 'joined'::match_participant_status_enum, false, now() FROM seed_conf c
ON CONFLICT (match_id, player_id) DO UPDATE SET
  team_number = EXCLUDED.team_number,
  is_host     = EXCLUDED.is_host,
  status      = EXCLUDED.status,
  has_paid    = EXCLUDED.has_paid,
  joined_at   = EXCLUDED.joined_at;

-- ============================================================================
-- MATCH 2 — Already paid (You've paid + Everyone has paid celebratory)
-- Host=user1 (undecided/no Stripe), Participant=user2 has_paid=true
--   user1 view: undecided prompt + ✓ "Everyone has paid you back" badge
--   user2 view: ✓ You've paid your share ($10.00)
-- ============================================================================
INSERT INTO match (id, sport_id, match_date, start_time, end_time, duration,
  format, location_type, facility_id, timezone, visibility, join_mode,
  cost_split_type, is_court_free, estimated_cost, created_by, location_name)
SELECT
  '11111111-aaaa-aaaa-aaaa-000000000002',
  c.sport_tennis, c.match_date, c.start_time, c.end_time, '90',
  'singles', 'facility', c.facility_id, c.tz, 'public', 'direct',
  'split_equal', false, 20.00, c.user1, 'Club de Tennis de Monkland'
FROM seed_conf c;

INSERT INTO match_participant (match_id, player_id, team_number, is_host, status, has_paid, joined_at)
SELECT '11111111-aaaa-aaaa-aaaa-000000000002'::uuid, c.user1, 1, true,  'joined'::match_participant_status_enum, false, now() FROM seed_conf c
UNION ALL
SELECT '11111111-aaaa-aaaa-aaaa-000000000002'::uuid, c.user2, 2, false, 'joined'::match_participant_status_enum, true,  now() FROM seed_conf c
ON CONFLICT (match_id, player_id) DO UPDATE SET
  team_number = EXCLUDED.team_number,
  is_host     = EXCLUDED.is_host,
  status      = EXCLUDED.status,
  has_paid    = EXCLUDED.has_paid,
  joined_at   = EXCLUDED.joined_at;

-- ============================================================================
-- MATCH 3 — JIT banner ($X ready to receive)
-- Host=user1 (undecided/Stripe NOT onboarded), Participant=user2 paid via Stripe
-- A pending_host_transfer row exists in 'awaiting_onboarding' status.
--   user1 view: JIT "$10.00 ready to receive" banner + undecided prompt + everyone-paid badge
--   user2 view: ✓ You've paid your share ($10.00)
-- ============================================================================
INSERT INTO match (id, sport_id, match_date, start_time, end_time, duration,
  format, location_type, facility_id, timezone, visibility, join_mode,
  cost_split_type, is_court_free, estimated_cost, created_by, location_name)
SELECT
  '11111111-aaaa-aaaa-aaaa-000000000003',
  c.sport_tennis, c.match_date, c.start_time, c.end_time, '90',
  'singles', 'facility', c.facility_id, c.tz, 'public', 'direct',
  'split_equal', false, 20.00, c.user1, 'Club de Tennis de Monkland'
FROM seed_conf c;

INSERT INTO match_participant (id, match_id, player_id, team_number, is_host, status, has_paid, payment_intent_id, joined_at)
SELECT '22222222-aaaa-aaaa-aaaa-000000000031'::uuid, '11111111-aaaa-aaaa-aaaa-000000000003'::uuid, c.user1, 1, true,  'joined'::match_participant_status_enum, false, NULL,                  now() FROM seed_conf c
UNION ALL
SELECT '22222222-aaaa-aaaa-aaaa-000000000032'::uuid, '11111111-aaaa-aaaa-aaaa-000000000003'::uuid, c.user2, 2, false, 'joined'::match_participant_status_enum, true,  'pi_seed_test_match3', now() FROM seed_conf c
ON CONFLICT (match_id, player_id) DO UPDATE SET
  team_number       = EXCLUDED.team_number,
  is_host           = EXCLUDED.is_host,
  status            = EXCLUDED.status,
  has_paid          = EXCLUDED.has_paid,
  payment_intent_id = EXCLUDED.payment_intent_id,
  joined_at         = EXCLUDED.joined_at;

-- Synthetic Stripe-routed payment awaiting host onboarding
INSERT INTO pending_host_transfer (match_participant_id, host_player_id, stripe_charge_id, stripe_payment_intent_id, amount_cents, currency, status, expires_at)
SELECT
  '22222222-aaaa-aaaa-aaaa-000000000032'::uuid,
  c.user1,
  'ch_seed_test_match3',
  'pi_seed_test_match3',
  1000,                    -- $10.00
  'CAD',
  'awaiting_onboarding',
  now() + INTERVAL '90 days'
FROM seed_conf c;

-- ============================================================================
-- MATCH 4 — Reverse roles (host onboarded, participant unpaid)
-- Host=user2 (auto/Stripe ONBOARDED), Participant=user1, NEITHER paid.
--   user2 view: NO prompt, NO JIT banner, just 0/1 progress + user1 row with Mark-as-Paid
--   user1 view: "Your share · $10.00" + Pay Now
-- ============================================================================
INSERT INTO match (id, sport_id, match_date, start_time, end_time, duration,
  format, location_type, facility_id, timezone, visibility, join_mode,
  cost_split_type, is_court_free, estimated_cost, created_by, location_name)
SELECT
  '11111111-aaaa-aaaa-aaaa-000000000004',
  c.sport_tennis, c.match_date, c.start_time, c.end_time, '90',
  'singles', 'facility', c.facility_id, c.tz, 'public', 'direct',
  'split_equal', false, 20.00, c.user2, 'Club de Tennis de Monkland'
FROM seed_conf c;

INSERT INTO match_participant (match_id, player_id, team_number, is_host, status, has_paid, joined_at)
SELECT '11111111-aaaa-aaaa-aaaa-000000000004'::uuid, c.user2, 1, true,  'joined'::match_participant_status_enum, false, now() FROM seed_conf c
UNION ALL
SELECT '11111111-aaaa-aaaa-aaaa-000000000004'::uuid, c.user1, 2, false, 'joined'::match_participant_status_enum, false, now() FROM seed_conf c
ON CONFLICT (match_id, player_id) DO UPDATE SET
  team_number = EXCLUDED.team_number,
  is_host     = EXCLUDED.is_host,
  status      = EXCLUDED.status,
  has_paid    = EXCLUDED.has_paid,
  joined_at   = EXCLUDED.joined_at;

COMMIT;

-- ============================================================================
-- Verify
-- ============================================================================
SELECT
  RIGHT(m.id::text, 1) AS m,
  m.match_date,
  m.estimated_cost,
  pr_host.first_name AS host,
  pl_host.payouts_mode AS host_payouts_mode,
  COALESCE(psa_host.onboarding_completed, false) AS host_stripe,
  STRING_AGG(pr_p.first_name || CASE WHEN mp.has_paid THEN '✓' ELSE '✗' END, ', ' ORDER BY mp.team_number) AS participants,
  COALESCE((SELECT SUM(amount_cents) FROM pending_host_transfer pht
            WHERE pht.host_player_id = m.created_by AND pht.status='awaiting_onboarding'
            AND pht.match_participant_id IN (SELECT id FROM match_participant WHERE match_id = m.id)
           ), 0) AS pending_cents
FROM match m
JOIN profile pr_host ON pr_host.id = m.created_by
JOIN player pl_host ON pl_host.id = m.created_by
LEFT JOIN player_stripe_account psa_host ON psa_host.player_id = m.created_by
JOIN match_participant mp ON mp.match_id = m.id
JOIN profile pr_p ON pr_p.id = mp.player_id
WHERE m.id::text LIKE '11111111-aaaa-aaaa-aaaa-00000000000%'
GROUP BY m.id, m.match_date, m.estimated_cost, pr_host.first_name, pl_host.payouts_mode, psa_host.onboarding_completed, m.created_by
ORDER BY m.id;
