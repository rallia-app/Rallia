#!/usr/bin/env node
/**
 * Build a fresh recipient CSV for the 'new' or 'active' cohort, straight from the DB.
 *
 * Why a generator instead of frozen files: these are MOVING windows. "New" shifts every
 * day, so generate the list right before each wave rather than letting it go stale.
 *
 * Definitions:
 *   new    = profile.created_at between <newMaxDays> and <newMinDays> days ago (default 21..7,
 *            i.e. old enough to have real experience, recent enough to still be new)
 *   active = signed up more than <newMaxDays> days ago AND profile.last_active_at within
 *            the last <activeDays> days (default 14)
 *   Both require account_status='active' and a non-empty first_name, and exclude the founders.
 *
 * IMPORTANT caveat for 'active': profile.last_active_at undercounts real activity (the mobile
 * app refreshes sessions silently). On prod it surfaces ~80 people vs ~325 truly active in
 * PostHog. That is FINE here because you only sample a couple dozen active users to interview,
 * not all of them. But do not read the 'active' count as your true active-user total. For an
 * exhaustive active list, generate it from PostHog ($screen in last 30d) instead.
 *
 * Read-only. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as the sender).
 *
 * Usage (run from repo root):
 *   # preview a count + first rows (no file written)
 *   node scripts/outreach/build-cohort-csv.mjs --cohort new
 *   # write the file
 *   node scripts/outreach/build-cohort-csv.mjs --cohort new   --out scripts/outreach/waves/new.csv
 *   node scripts/outreach/build-cohort-csv.mjs --cohort active --out scripts/outreach/waves/active.csv --limit 30
 */

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const FOUNDER_EMAILS = ['lefrancmathis@gmail.com', 'jdl.sonkin@gmail.com'];

function parseArgs(argv) {
  const o = { cohort: null, out: null, newMinDays: 7, newMaxDays: 21, activeDays: 14, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cohort') o.cohort = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--newMinDays') o.newMinDays = parseInt(argv[++i], 10);
    else if (a === '--newMaxDays') o.newMaxDays = parseInt(argv[++i], 10);
    else if (a === '--activeDays') o.activeDays = parseInt(argv[++i], 10);
    else if (a === '--limit') o.limit = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

const cutoff = days => new Date(Date.now() - days * 86400000).toISOString();
const refFromUrl = url => { try { return new URL(url).hostname.split('.')[0]; } catch { return '(?)'; } };

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log('Usage: --cohort new|active [--out path] [--limit N] [--newMinDays 7] [--newMaxDays 21] [--activeDays 14]'); return; }
  if (o.cohort !== 'new' && o.cohort !== 'active') {
    console.error('Pass --cohort new  or  --cohort active'); process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let q = supabase
    .from('profile')
    .select('email, first_name, created_at, last_active_at')
    .eq('account_status', 'active')
    .not('first_name', 'is', null)
    .neq('first_name', '');

  if (o.cohort === 'new') {
    // Window: long enough in to have something to say, recent enough to still count as new.
    q = q.gte('created_at', cutoff(o.newMaxDays))
         .lt('created_at', cutoff(o.newMinDays))
         .order('created_at', { ascending: false });
  } else {
    q = q.lt('created_at', cutoff(o.newMaxDays))
         .gte('last_active_at', cutoff(o.activeDays))
         .order('last_active_at', { ascending: false });
  }
  if (o.limit) q = q.limit(o.limit);

  const { data, error } = await q;
  if (error) { console.error('Query failed:', error.message); process.exit(1); }

  const founders = new Set(FOUNDER_EMAILS);
  const seen = new Set();
  const rows = [];
  for (const r of data || []) {
    const email = (r.email || '').trim().toLowerCase();
    if (!email || founders.has(email) || seen.has(email)) continue;
    seen.add(email);
    rows.push(`${email},${o.cohort}`);
  }

  console.log(`Project ref: ${refFromUrl(url)}`);
  console.log(`Cohort: ${o.cohort}  |  rows: ${rows.length}${o.limit ? ` (capped at ${o.limit})` : ''}`);
  if (o.cohort === 'active') {
    console.log('Note: this is the last_active_at-based slice and undersamples true active users. Fine for sampling a few to interview; not a true active total.');
  }

  const csv = 'email,segment\n' + rows.join('\n') + (rows.length ? '\n' : '');
  if (o.out) {
    writeFileSync(o.out, csv);
    console.log(`Wrote ${rows.length} rows to ${o.out}`);
  } else {
    console.log('\nPreview (first 8 rows, no file written; pass --out to save):');
    console.log(['email,segment', ...rows.slice(0, 8)].join('\n'));
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
