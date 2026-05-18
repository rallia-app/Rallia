/**
 * Synthetic UTM landings generator for the dev-only demo toggle on the
 * Acquisition tab. Produces stable, realistic-looking data so the chart
 * has visible series without sending fake events to PostHog.
 *
 * Determinism: a tiny string-hash seeds the per-day value, so reloading
 * the page renders the same shape (no jittering).
 */

import type { WindowParam } from './posthog-query';

interface UtmLandingsResponse {
  window: WindowParam;
  landings: { source: string; medium: string; campaign: string; count: number }[];
  timeseries: { day: string; campaign: string; landings: number }[];
  totals: { landings: number; uniqueVisitors: number };
  previousTotals?: { landings: number; uniqueVisitors: number };
}

// Same canonical mix as scripts/seed-utm-test-data.sql so the demo and the
// real Supabase signups line up on the same campaign slugs.
const DEMO_MIX = [
  { source: 'instagram', medium: 'social', campaign: 'friends_family_2026', baseDaily: 30 },
  { source: 'whatsapp', medium: 'referral', campaign: 'friends_family_2026', baseDaily: 18 },
  { source: 'tiktok', medium: 'social', campaign: 'friends_family_2026', baseDaily: 14 },
  { source: 'app_share', medium: 'in_app', campaign: 'friends_family_2026', baseDaily: 11 },
  { source: 'meta_ads', medium: 'paid_social', campaign: 'always_on_2026', baseDaily: 22 },
  { source: 'google_ads', medium: 'cpc', campaign: 'always_on_2026', baseDaily: 16 },
  { source: 'blog', medium: 'organic', campaign: 'always_on_2026', baseDaily: 6 },
  { source: 'newsletter', medium: 'email', campaign: 'february_2026_digest', baseDaily: 9 },
  { source: 'instagram', medium: 'social', campaign: 'pickleball_launch_2026_q2', baseDaily: 12 },
  { source: 'reddit', medium: 'organic', campaign: 'pickleball_launch_2026_q2', baseDaily: 5 },
  { source: 'partner', medium: 'qr', campaign: 'tennis_canada_2026', baseDaily: 4 },
  { source: 'event', medium: 'qr', campaign: 'pop_up_2026', baseDaily: 2 },
];

const WINDOW_TO_DAYS: Record<WindowParam, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Tiny stable hash → [0, 1). Cheap, plenty good enough for variance. */
function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function getDemoUtmData(window: WindowParam): UtmLandingsResponse {
  const days = WINDOW_TO_DAYS[window];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const timeseries: UtmLandingsResponse['timeseries'] = [];
  const campaignTotals = new Map<string, number>();
  const tupleTotals = new Map<string, { row: (typeof DEMO_MIX)[number]; count: number }>();

  for (let d = days - 1; d >= 0; d--) {
    const dayStart = new Date(now - d * dayMs);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayIso = dayStart.toISOString();

    // Roll up to one timeseries row per (day, campaign) — sum across the
    // tuples that share a campaign so the chart sees total daily landings.
    const perCampaign = new Map<string, number>();

    for (const entry of DEMO_MIX) {
      // Per-day variance: stable hash of day+source+campaign, scaled to ±60%.
      const variance = 0.4 + hash01(`${dayIso}|${entry.source}|${entry.campaign}`) * 1.2;
      const dailyCount = Math.max(0, Math.round(entry.baseDaily * variance));

      perCampaign.set(entry.campaign, (perCampaign.get(entry.campaign) ?? 0) + dailyCount);

      const tupleKey = `${entry.source}|${entry.medium}|${entry.campaign}`;
      const existing = tupleTotals.get(tupleKey);
      if (existing) existing.count += dailyCount;
      else tupleTotals.set(tupleKey, { row: entry, count: dailyCount });
    }

    for (const [campaign, count] of perCampaign) {
      timeseries.push({ day: dayIso, campaign, landings: count });
      campaignTotals.set(campaign, (campaignTotals.get(campaign) ?? 0) + count);
    }
  }

  const landings = Array.from(tupleTotals.values())
    .map(({ row, count }) => ({
      source: row.source,
      medium: row.medium,
      campaign: row.campaign,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const totalLandings = landings.reduce((acc, r) => acc + r.count, 0);
  // Rough visitor estimate: ~70% of landings are unique (return visitors exist).
  const uniqueVisitors = Math.round(totalLandings * 0.7);

  // Synthesize a "previous period" total ~15% lower so demos show a positive
  // trend by default — concrete enough to read as "we're growing".
  const previousLandings = Math.round(totalLandings * 0.85);
  const previousUnique = Math.round(uniqueVisitors * 0.85);

  return {
    window,
    landings,
    timeseries,
    totals: { landings: totalLandings, uniqueVisitors },
    previousTotals: { landings: previousLandings, uniqueVisitors: previousUnique },
  };
}
