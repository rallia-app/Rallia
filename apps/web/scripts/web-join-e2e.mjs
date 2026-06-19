#!/usr/bin/env node
/**
 * End-to-end test for the web-join flow against a LOCAL stack.
 *
 * Drives the REAL Next.js API routes with a REAL authenticated session — it
 * mints valid Supabase auth cookies with @supabase/ssr (the same library the
 * routes use), so no OAuth/OTP automation is needed. Creates a throwaway user,
 * exercises the full lifecycle, then deletes the user (cascade cleanup).
 *
 * Prereqs: local Supabase running (127.0.0.1:54321) and the web dev server on
 * APP_URL (default http://localhost:3000) pointed at that local stack
 * (the `web-local` launch config does this).
 *
 * Usage (from repo root, dev server running):
 *   node apps/web/scripts/web-join-e2e.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

// Standard local Supabase demo keys (public, identical on every local install).
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const LOCALE = 'en-US';

const TEST_EMAIL = `webjoin-e2e+${Date.now()}@fake-rallia.com`;
const TEST_PASSWORD = 'E2e-test-pw-123456';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Minutes that `tz` is offset from UTC at the given instant (DST-correct). */
function tzOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}
/** UTC ms for a match's wall-clock start time interpreted in its timezone. */
function startInstantMs(m) {
  const [y, mo, d] = m.match_date.split('-').map(Number);
  const [hh, mm, ss = 0] = m.start_time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm, ss);
  return guess - tzOffsetMinutes(m.timezone || 'UTC', new Date(guess)) * 60000;
}

async function pickMatches() {
  // A: public, future, direct, not full, no gender/rating gate -> deterministic "joined" + leavable.
  const { data: aRows } = await admin
    .from('match')
    .select('id, sport_id, format, match_date, start_time, timezone')
    .eq('visibility', 'public')
    .is('cancelled_at', null)
    .eq('join_mode', 'direct')
    .is('preferred_opponent_gender', null)
    .is('min_rating_score_id', null)
    .not('sport_id', 'is', null)
    .not('format', 'is', null);

  let A = null;
  for (const m of aRows || []) {
    if (startInstantMs(m) <= Date.now()) continue; // must be in the future so leave is allowed
    const { count } = await admin
      .from('match_participant')
      .select('*', { count: 'exact', head: true })
      .eq('match_id', m.id)
      .eq('status', 'joined');
    const cap = m.format === 'doubles' ? 4 : 2;
    if ((count ?? 0) < cap) {
      A = m;
      break;
    }
  }

  // B: any other public future match (for the limit test).
  const { data: bRows } = await admin
    .from('match')
    .select('id')
    .eq('visibility', 'public')
    .is('cancelled_at', null)
    .not('sport_id', 'is', null)
    .not('format', 'is', null)
    .limit(50);
  const B = (bRows || []).map((r) => r.id).find((id) => id !== A?.id);
  return { A, B };
}

async function main() {
  console.log(`\nWeb-join E2E  (app=${APP_URL}, supabase=${SUPABASE_URL})`);
  console.log(`Test user: ${TEST_EMAIL}\n`);

  // 1. Create a confirmed test user with a password.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr) throw new Error(`createUser failed: ${createErr.message}`);
  const userId = created.user.id;

  try {
    // 2. Pick matches.
    const { A, B } = await pickMatches();
    if (!A || !B) throw new Error('Could not find suitable test matches (need a direct/future/not-full A and another B).');
    const { data: anyRating } = await admin.from('rating_score').select('id').limit(1).single();
    console.log(`Match A (join target): ${A.id}  |  Match B (limit target): ${B}\n`);

    // 3. Mint real auth cookies via @supabase/ssr (same lib the routes read).
    const jar = new Map();
    const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
      },
    });
    const { error: signInErr } = await ssr.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);
    const cookieHeader = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
    if (!cookieHeader) throw new Error('No auth cookies were minted.');

    const api = async (path, method = 'POST', body) => {
      const res = await fetch(`${APP_URL}${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = {};
      try {
        json = await res.json();
      } catch {
        /* empty */
      }
      return { status: res.status, json };
    };

    const profilePayload = {
      matchId: A.id,
      locale: LOCALE,
      personal: { firstName: 'E2E', lastName: 'Tester', gender: 'male', birthDate: '1990-01-01' },
      sportId: A.sport_id,
      ratingScoreId: anyRating?.id,
      location: { postalCode: 'H2X1Y4', city: 'Montreal', province: 'QC', latitude: 45.5, longitude: -73.5 },
    };

    // ---- Assertions ----
    console.log('Join (new-user full profile) on match A:');
    const join = await api('/api/web-join/complete', 'POST', profilePayload);
    check('join returns 200 + joinStatus=joined', join.status === 200 && join.json.joinStatus === 'joined', `got ${join.status} ${JSON.stringify(join.json)}`);

    const { data: profileRow } = await admin.from('profile').select('onboarding_completed, acquisition_channel').eq('id', userId).maybeSingle();
    check('profile created (onboarding_completed + acquisition_channel=web_join)', profileRow?.onboarding_completed === true && profileRow?.acquisition_channel === 'web_join', JSON.stringify(profileRow));
    const { data: playerRow } = await admin.from('player').select('id').eq('id', userId).maybeSingle();
    check('player record created', !!playerRow);
    const { data: wj1 } = await admin.from('web_join').select('match_id').eq('player_id', userId);
    check('web_join recorded for match A', (wj1 || []).some((r) => r.match_id === A.id), JSON.stringify(wj1));

    console.log('\nChat (match conversation) for match A:');
    const { data: conv } = await admin.from('conversation').select('id').eq('match_id', A.id).maybeSingle();
    check('match conversation exists', !!conv?.id);
    if (conv?.id) {
      const { data: cp } = await admin.from('conversation_participant').select('player_id').eq('conversation_id', conv.id).eq('player_id', userId).maybeSingle();
      check('test user is a conversation participant', !!cp);
    }

    console.log('\nWeb-join limit (second, different match B):');
    const blocked = await api('/api/web-join/complete', 'POST', { matchId: B, locale: LOCALE });
    check('second match blocked with 403 WEB_JOIN_LIMIT', blocked.status === 403 && blocked.json.error === 'WEB_JOIN_LIMIT', `got ${blocked.status} ${JSON.stringify(blocked.json)}`);

    console.log('\nLeave match A (before it starts):');
    const leave = await api('/api/web-join/leave', 'POST', { matchId: A.id });
    check('leave returns 200', leave.status === 200 && leave.json.success === true, `got ${leave.status} ${JSON.stringify(leave.json)}`);
    const { data: partAfter } = await admin.from('match_participant').select('status').eq('match_id', A.id).eq('player_id', userId).maybeSingle();
    check('participant status is now left', partAfter?.status === 'left', JSON.stringify(partAfter));
    const { data: wj2 } = await admin.from('web_join').select('match_id').eq('player_id', userId).eq('match_id', A.id);
    check('web_join for A still present after leave (allowance stays spent)', (wj2 || []).length === 1);

    console.log('\nAfter leaving, allowance still spent (B still blocked):');
    const stillBlocked = await api('/api/web-join/complete', 'POST', { matchId: B, locale: LOCALE });
    check('second match still 403 WEB_JOIN_LIMIT after leave', stillBlocked.status === 403 && stillBlocked.json.error === 'WEB_JOIN_LIMIT', `got ${stillBlocked.status} ${JSON.stringify(stillBlocked.json)}`);

    console.log('\nRe-join the SAME match A (allowed — own web_join row does not block itself):');
    const rejoin = await api('/api/web-join/complete', 'POST', { matchId: A.id, locale: LOCALE });
    check('re-join same match returns 200', rejoin.status === 200 && ['joined', 'requested', 'waitlisted'].includes(rejoin.json.joinStatus), `got ${rejoin.status} ${JSON.stringify(rejoin.json)}`);
  } finally {
    // Cleanup: deleting the auth user cascades to profile/player/web_join/match_participant.
    await admin.auth.admin.deleteUser(userId).catch((e) => console.log('cleanup warning:', e?.message));
  }

  console.log(`\n${failed === 0 ? '✅ ALL PASSED' : '❌ FAILURES'}  (${passed} passed, ${failed} failed)\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nE2E ERROR:', err.message);
  process.exit(1);
});
