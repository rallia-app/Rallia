#!/usr/bin/env node
/**
 * Optional companion to scripts/seed-utm-test-data.sql.
 *
 * Sends ~60 labelled `deep_link_opened` events to PostHog so the admin
 * Acquisition tab's Landings KPI, dimension tables, and multi-series chart
 * have data to render. Each event carries `seed_run: true` so you can
 * filter or delete them in PostHog later (the SQL seed has no equivalent
 * because it overwrites real columns directly).
 *
 * WARNING: this hits your live PostHog ingestion endpoint. There is no
 * "local PostHog" — the project key in apps/web/.env points at production.
 * Run only when you accept polluting your analytics with test events.
 *
 * Required env (read from apps/web/.env automatically):
 *   NEXT_PUBLIC_POSTHOG_KEY   — project capture key (NOT the personal key)
 *   NEXT_PUBLIC_POSTHOG_HOST  — e.g. https://us.i.posthog.com
 *
 * Run with:
 *   node scripts/seed-utm-posthog-landings.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', 'apps', 'web', '.env');
let envText = '';
try {
  envText = readFileSync(envPath, 'utf8');
} catch {
  console.error(`Could not read ${envPath}. Make sure apps/web/.env exists.`);
  process.exit(1);
}

const env = Object.fromEntries(
  envText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const eq = line.indexOf('=');
      return eq === -1 ? [line, ''] : [line.slice(0, eq), line.slice(eq + 1)];
    })
);

const POSTHOG_KEY = env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = (env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');

if (!POSTHOG_KEY || POSTHOG_KEY === 'your-posthog-key') {
  console.error('NEXT_PUBLIC_POSTHOG_KEY is missing or unset in apps/web/.env');
  process.exit(1);
}

// Same campaign mix as scripts/seed-utm-test-data.sql, weighted so the chart
// has visible top campaigns (friends_family_2026 dominates, then always_on_2026).
const CAMPAIGNS = [
  { source: 'instagram', medium: 'social', campaign: 'friends_family_2026', weight: 30 },
  { source: 'whatsapp', medium: 'referral', campaign: 'friends_family_2026', weight: 20 },
  { source: 'tiktok', medium: 'social', campaign: 'friends_family_2026', weight: 15 },
  { source: 'app_share', medium: 'in_app', campaign: 'friends_family_2026', weight: 12 },
  { source: 'meta_ads', medium: 'paid_social', campaign: 'always_on_2026', weight: 18 },
  { source: 'google_ads', medium: 'cpc', campaign: 'always_on_2026', weight: 15 },
  { source: 'blog', medium: 'organic', campaign: 'always_on_2026', weight: 8 },
  { source: 'newsletter', medium: 'email', campaign: 'february_2026_digest', weight: 10 },
  { source: 'instagram', medium: 'social', campaign: 'pickleball_launch_2026_q2', weight: 12 },
  { source: 'reddit', medium: 'organic', campaign: 'pickleball_launch_2026_q2', weight: 6 },
  { source: 'partner', medium: 'qr', campaign: 'tennis_canada_2026', weight: 5 },
  { source: 'event', medium: 'qr', campaign: 'pop_up_2026', weight: 3 },
];

const totalWeight = CAMPAIGNS.reduce((acc, c) => acc + c.weight, 0);

function pickCampaign() {
  let r = Math.random() * totalWeight;
  for (const c of CAMPAIGNS) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return CAMPAIGNS[0];
}

// Spread events across the past 30 days so every preset window shows data.
function pickTimestamp() {
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  const skewedAge = Math.pow(Math.random(), 2) * maxAgeMs; // bias toward recent
  return new Date(Date.now() - skewedAge).toISOString();
}

const NUM_EVENTS = 200;
const events = [];
for (let i = 0; i < NUM_EVENTS; i++) {
  const c = pickCampaign();
  events.push({
    api_key: POSTHOG_KEY,
    event: 'deep_link_opened',
    distinct_id: `seed_visitor_${Math.floor(Math.random() * 80)}`,
    timestamp: pickTimestamp(),
    properties: {
      link_type: 'utm',
      first_touch: true,
      utm_source: c.source,
      utm_medium: c.medium,
      utm_campaign: c.campaign,
      seed_run: true,
      seed_run_id: `utm-seed-${new Date().toISOString().slice(0, 10)}`,
    },
  });
}

console.log(`Sending ${events.length} test landings to ${POSTHOG_HOST}…`);

const res = await fetch(`${POSTHOG_HOST}/batch/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ api_key: POSTHOG_KEY, batch: events }),
});

if (!res.ok) {
  console.error(`PostHog ingest failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log('Done. Events typically appear in PostHog within ~30s.');
console.log(`Filter or delete later with property: seed_run = true`);
