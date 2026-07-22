// Integration check for lt-payment-webhook against a LOCAL served function.
//
// The unit tests (supabase/functions/tests/lt-payment-webhook-test.ts) prove the
// decision logic; this proves the wiring — that the function applies those
// decisions to the real ledger + registration rows, in the right order, with a
// verified Stripe signature. It caught every webhook bug in the 2026-07-21 audit.
//
// Prerequisites (it is a MANUAL harness, not part of CI):
//   1. Local stack up:      npx supabase start
//   2. Function served with the test secret below, e.g.:
//        npx supabase functions serve lt-payment-webhook \
//          --env-file <(printf 'STRIPE_SECRET_KEY=sk_test_dummy\n\
//   STRIPE_LT_WEBHOOK_SECRET=%s\nSUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' \
//          "$WEBHOOK_SECRET" "$SUPABASE_URL" "$SERVICE_ROLE_KEY") --no-verify-jwt
//   3. Run:                 node scripts/dev/lt-webhook-integration-check.mjs
//
// Config via env (local defaults shown): DB_URL, FUNCTION_URL, WEBHOOK_SECRET.
// Exits non-zero if any check fails.

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const URL =
  process.env.FUNCTION_URL ?? 'http://127.0.0.1:54321/functions/v1/lt-payment-webhook';
const SECRET = process.env.WEBHOOK_SECRET ?? 'whsec_test_secret_for_local_verification';

const sql = q => execFileSync('psql', [DB, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim();

// Resolve seed-agnostic actors: a tennis sport, a tennis-playing payer, an organizer.
const SPORT = sql("SELECT id FROM sport WHERE name='tennis'");
const PAYER = sql(
  `SELECT ps.player_id FROM player_sport ps WHERE ps.sport_id='${SPORT}' AND ps.is_active ORDER BY ps.player_id LIMIT 1`
);
const ORG = sql(`SELECT id FROM player WHERE id <> '${PAYER}' ORDER BY id LIMIT 1`);
if (!SPORT || !PAYER || !ORG) {
  console.error('seed lookup failed — is the local DB seeded?');
  process.exit(2);
}

function sign(body) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

async function send(type, pi) {
  const body = JSON.stringify({
    id: 'evt_' + crypto.randomBytes(8).toString('hex'),
    object: 'event',
    type,
    data: { object: pi },
  });
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(body) },
    body,
  });
  return { status: res.status, text: await res.text() };
}

const PI = (id, charge = 'ch_' + id) => ({
  id,
  object: 'payment_intent',
  latest_charge: charge,
  metadata: { rallia_flow: 'lt_registration' },
});

// Fresh paid tournament + one payment_pending reservation, tagged by PI id.
function seed(piId, tag) {
  const tid = `ffff0000-0000-0000-0000-00000000${tag}`;
  // Delete ledger before registrations: the ledger FK is ON DELETE RESTRICT.
  sql(`
    DELETE FROM lt_registration_payment WHERE tournament_registration_id IN
      (SELECT id FROM tournament_registrations WHERE tournament_id='${tid}');
    DELETE FROM tournament_registrations WHERE tournament_id='${tid}';
    DELETE FROM tournaments WHERE id='${tid}';
    INSERT INTO tournaments (id,name,sport_id,max_participants,start_date,end_date,organizer_id,status,registration_mode,visibility,entry_fee_cents,fee_payer,refund_policy_kind)
    VALUES ('${tid}','[WHTEST] ${tag}','${SPORT}',16,
            now()+interval '30 days',now()+interval '31 days','${ORG}','registration_open','open','public',5000,'player_pays','full');
    SELECT set_config('request.jwt.claims','{"sub":"${PAYER}"}',false);
    SELECT tournament_begin_paid_registration('${tid}', NULL);
    UPDATE lt_registration_payment SET stripe_payment_intent_id='${piId}'
     WHERE tournament_registration_id=(SELECT id FROM tournament_registrations WHERE tournament_id='${tid}');
  `);
  return tid;
}

const state = piId => ({
  ledger: sql(`SELECT status FROM lt_registration_payment WHERE stripe_payment_intent_id='${piId}'`),
  charge: sql(
    `SELECT coalesce(stripe_charge_id,'-') FROM lt_registration_payment WHERE stripe_payment_intent_id='${piId}'`
  ),
  reg: sql(
    `SELECT r.status FROM tournament_registrations r JOIN lt_registration_payment p ON p.tournament_registration_id=r.id WHERE p.stripe_payment_intent_id='${piId}'`
  ),
});

const results = [];
const check = (name, pass, detail) => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);

// W1: happy path — pending ledger, payment_pending reg → succeeded + registered
{
  const pi = 'pi_w1';
  seed(pi, 'a001');
  await send('payment_intent.succeeded', PI(pi));
  const s = state(pi);
  check('W1 happy path', s.ledger === 'succeeded' && s.reg === 'registered', `ledger=${s.ledger} reg=${s.reg}`);
}

// W2: re-delivery after a crash between ledger write and reg flip
// (ledger already succeeded, reg still payment_pending) → must recover the flip.
{
  const pi = 'pi_w2';
  seed(pi, 'a002');
  sql(`UPDATE lt_registration_payment SET status='succeeded' WHERE stripe_payment_intent_id='${pi}'`);
  await send('payment_intent.succeeded', PI(pi));
  const s = state(pi);
  check('W2 redelivery recovers', s.reg === 'registered', `ledger=${s.ledger} reg=${s.reg}`);
}

// W3: reaper race — ledger cancelled, reg withdrawn, late success arrives.
// Must NOT promote (that would pay the organizer for a non-registrant).
{
  const pi = 'pi_w3';
  const tid = seed(pi, 'a003');
  sql(`UPDATE lt_registration_payment SET status='cancelled' WHERE stripe_payment_intent_id='${pi}';
       UPDATE tournament_registrations SET status='withdrawn' WHERE tournament_id='${tid}';`);
  await send('payment_intent.succeeded', PI(pi));
  const s = state(pi);
  check('W3 reaper race not promoted', s.ledger === 'cancelled' && s.reg === 'withdrawn', `ledger=${s.ledger} reg=${s.reg}`);
  check('W3 charge recorded for reconciliation', s.charge === 'ch_pi_w3', `charge=${s.charge}`);
}

// W4: superseded attempt — cancelled ledger, reg still payment_pending (a newer
// attempt owns it). Must not flip on the old PI.
{
  const pi = 'pi_w4';
  seed(pi, 'a004');
  sql(`UPDATE lt_registration_payment SET status='cancelled' WHERE stripe_payment_intent_id='${pi}'`);
  await send('payment_intent.succeeded', PI(pi));
  const s = state(pi);
  check('W4 superseded not promoted', s.ledger === 'cancelled' && s.reg === 'payment_pending', `ledger=${s.ledger} reg=${s.reg}`);
}

// W5: refunded row must not be re-seated
{
  const pi = 'pi_w5';
  seed(pi, 'a005');
  sql(`UPDATE lt_registration_payment SET status='refunded' WHERE stripe_payment_intent_id='${pi}'`);
  await send('payment_intent.succeeded', PI(pi));
  const s = state(pi);
  check('W5 refunded not re-seated', s.ledger === 'refunded' && s.reg === 'payment_pending', `ledger=${s.ledger} reg=${s.reg}`);
}

// W6: payment_failed releases the slot
{
  const pi = 'pi_w6';
  seed(pi, 'a006');
  await send('payment_intent.payment_failed', PI(pi));
  const s = state(pi);
  check('W6 failure releases slot', s.ledger === 'failed' && s.reg === 'withdrawn', `ledger=${s.ledger} reg=${s.reg}`);
}

// W7: bad signature rejected
{
  const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: PI('pi_w7') } });
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
    body,
  });
  check('W7 bad signature rejected', res.status === 400, `status=${res.status}`);
}

// Cleanup our tagged rows (ledger first: FK is RESTRICT).
sql(`
  DELETE FROM lt_registration_payment WHERE tournament_registration_id IN
    (SELECT r.id FROM tournament_registrations r JOIN tournaments t ON t.id=r.tournament_id WHERE t.name LIKE '[WHTEST]%');
  DELETE FROM tournament_registrations WHERE tournament_id IN
    (SELECT id FROM tournaments WHERE name LIKE '[WHTEST]%');
  DELETE FROM tournaments WHERE name LIKE '[WHTEST]%';
`);

console.log(results.join('\n'));
const allPass = results.every(r => r.startsWith('PASS'));
console.log(allPass ? '\nALL PASS' : '\nFAILURES PRESENT');
process.exit(allPass ? 0 : 1);
