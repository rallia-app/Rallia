import { NextResponse } from 'next/server';

import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import {
  isWindowParam,
  PostHogQueryError,
  runHogQL,
  windowToHours,
  type WindowParam,
} from '@/lib/posthog-query';
import { getDemoUtmData } from '@/lib/utm-demo-data';

/**
 * Admin-gated UTM landings endpoint. Aggregates `deep_link_opened` events
 * from PostHog by utm_source / utm_medium / utm_campaign for the requested
 * window, plus a top-5 campaign timeseries for the chart.
 *
 * Cached for 60s — admin polling is shared across all callers.
 */
export const revalidate = 60;

type LandingRow = {
  source: string;
  medium: string;
  campaign: string;
  count: number;
};

type TimeseriesRow = {
  day: string;
  campaign: string;
  landings: number;
};

type TotalsRow = {
  landings: number;
  uniqueVisitors: number;
};

type PreviousTotalsRow = {
  previousLandings: number;
  previousUniqueVisitors: number;
};

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { allowed } = await requireApiRole(user.id, ['super_admin', 'analyst']);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const windowRaw = url.searchParams.get('window') ?? '7d';
    if (!isWindowParam(windowRaw)) {
      return NextResponse.json({ error: 'Invalid window' }, { status: 400 });
    }
    const window: WindowParam = windowRaw;

    // Demo escape hatch — synthesises landings without touching PostHog so the
    // chart has visible series during product walkthroughs. Gated to non-prod
    // so it can never accidentally serve fake numbers in production.
    if (url.searchParams.get('demo') === '1' && process.env.NODE_ENV !== 'production') {
      return NextResponse.json(getDemoUtmData(window));
    }

    const hours = windowToHours(window);
    const compare = url.searchParams.get('compare') === '1';

    // Filter to events fired by web's utm-capture.tsx specifically. Mobile
    // (App.tsx) also fires `deep_link_opened` with utm_* whenever a Universal
    // Link carries them (e.g. tap on a Smart App Banner with app-argument);
    // without the `$lib = 'web'` clause every installed-user banner tap would
    // double-count the web landing it originated from.
    const whereClause = `
      event = 'deep_link_opened'
      AND properties.$lib = 'web'
      AND timestamp >= now() - INTERVAL ${hours} HOUR
      AND (
        properties.utm_source IS NOT NULL
        OR properties.utm_medium IS NOT NULL
        OR properties.utm_campaign IS NOT NULL
      )
    `;

    const previousWhere = `
      event = 'deep_link_opened'
      AND properties.$lib = 'web'
      AND timestamp >= now() - INTERVAL ${hours * 2} HOUR
      AND timestamp <  now() - INTERVAL ${hours} HOUR
      AND (
        properties.utm_source IS NOT NULL
        OR properties.utm_medium IS NOT NULL
        OR properties.utm_campaign IS NOT NULL
      )
    `;

    const queries: Promise<unknown>[] = [
      runHogQL<LandingRow>(`
        SELECT
          coalesce(properties.utm_source,   '(none)') AS source,
          coalesce(properties.utm_medium,   '(none)') AS medium,
          coalesce(properties.utm_campaign, '(none)') AS campaign,
          count() AS count
        FROM events
        WHERE ${whereClause}
        GROUP BY source, medium, campaign
        ORDER BY count DESC
        LIMIT 200
      `),
      runHogQL<TotalsRow>(`
        SELECT
          count() AS landings,
          count(DISTINCT person_id) AS uniqueVisitors
        FROM events
        WHERE ${whereClause}
      `),
      runHogQL<TimeseriesRow>(`
        WITH top_campaigns AS (
          SELECT coalesce(properties.utm_campaign, '(none)') AS campaign
          FROM events
          WHERE ${whereClause}
          GROUP BY campaign
          ORDER BY count() DESC
          LIMIT 20
        )
        SELECT
          toStartOfDay(timestamp) AS day,
          coalesce(properties.utm_campaign, '(none)') AS campaign,
          count() AS landings
        FROM events
        WHERE ${whereClause}
          AND coalesce(properties.utm_campaign, '(none)') IN (SELECT campaign FROM top_campaigns)
        GROUP BY day, campaign
        ORDER BY day ASC, campaign
      `),
    ];
    if (compare) {
      queries.push(
        runHogQL<PreviousTotalsRow>(`
          SELECT
            count() AS previousLandings,
            count(DISTINCT person_id) AS previousUniqueVisitors
          FROM events
          WHERE ${previousWhere}
        `)
      );
    }
    const results = await Promise.all(queries);
    const landings = results[0] as LandingRow[];
    const totalsRows = results[1] as TotalsRow[];
    const timeseries = results[2] as TimeseriesRow[];
    const previousRow = compare ? ((results[3] as PreviousTotalsRow[])[0] ?? null) : null;

    return NextResponse.json({
      window,
      landings,
      timeseries,
      totals: totalsRows[0] ?? { landings: 0, uniqueVisitors: 0 },
      ...(previousRow
        ? {
            previousTotals: {
              landings: Number(previousRow.previousLandings) || 0,
              uniqueVisitors: Number(previousRow.previousUniqueVisitors) || 0,
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof PostHogQueryError) {
      console.error('[Admin UTM] PostHog query failed:', error);
      return NextResponse.json(
        { error: 'Analytics provider unavailable', detail: error.message },
        { status: 502 }
      );
    }
    console.error('[Admin UTM] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch UTM analytics' },
      { status: 500 }
    );
  }
}
