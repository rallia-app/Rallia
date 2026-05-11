'use client';

import {
  useUtmLandings,
  useUtmSignupStats,
  useUtmTotalsComparison,
  type UtmLandingsResponse,
  type UtmSignupStat,
} from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { FunnelStrip } from '@/components/admin/funnel-strip';
import { KpiCard } from '@/components/admin/kpi-card';
import {
  MultiSeriesAreaChart,
  type ChartPoint,
  type ChartSeries,
} from '@/components/admin/multi-series-area-chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WindowOption } from '@/components/admin/utm-filter-bar';

type Dimension = 'campaign' | 'source' | 'medium';

const WINDOW_TO_DAYS: Record<WindowOption, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export interface UtmMonitoringSectionProps {
  window: WindowOption;
  autoRefresh: boolean;
  demo?: boolean;
  onLastFetchedAt?: (ts: number | null) => void;
}

/**
 * Top-level UTM section: KPI strip → 3-tab dimension table → multi-series
 * timeseries chart → drill-down funnel.
 *
 * Dual-source: pre-signup landings come from PostHog via the admin route
 * (useUtmLandings), signups + downstream matches come from Supabase
 * (useUtmSignupStats). They're joined client-side on the dimension key.
 */
export function UtmMonitoringSection({
  window,
  autoRefresh,
  demo = false,
  onLastFetchedAt,
}: UtmMonitoringSectionProps) {
  const t = useTranslations('admin.analytics');
  const refetchInterval = autoRefresh ? 60_000 : null;
  const days = WINDOW_TO_DAYS[window];

  const {
    data: landings,
    loading: landingsLoading,
    lastFetchedAt: landingsTs,
  } = useUtmLandings(window, { refetchInterval, demo, compare: true });
  const {
    stats: signups,
    loading: signupsLoading,
    lastFetchedAt: signupsTs,
  } = useUtmSignupStats(days, { refetchInterval });
  const { data: comparison } = useUtmTotalsComparison(days, { refetchInterval });

  // Surface the most recent of the two timestamps to the parent filter bar.
  const lastFetchedAt = useMemo(() => {
    if (!landingsTs && !signupsTs) return null;
    return Math.max(landingsTs ?? 0, signupsTs ?? 0);
  }, [landingsTs, signupsTs]);
  useEffect(() => {
    onLastFetchedAt?.(lastFetchedAt);
  }, [lastFetchedAt, onLastFetchedAt]);

  const [dimension, setDimension] = useState<Dimension>('campaign');
  const [drilldownKey, setDrilldownKey] = useState<string | null>(null);
  const [chartTopN, setChartTopN] = useState<5 | 10 | 20>(10);

  const aggregated = useAggregated(landings, signups, dimension);
  const totalSignups = signups.reduce((acc, row) => acc + row.signups, 0);
  const totalLandings = landings?.totals.landings ?? 0;
  const conversionRate = totalLandings > 0 ? totalSignups / totalLandings : null;
  const topCampaign = useTopCampaign(signups);

  const chartData = useChartData(landings);
  const chartSeries = useChartSeries(landings, chartTopN);

  const drilldownRow = aggregated.find(r => r.key === drilldownKey) ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('utm.title')}</CardTitle>
        <p className="text-xs text-muted-foreground m-0 mt-1">{t('utm.description')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label={t('utm.landings')}
            value={landingsLoading ? null : totalLandings}
            loading={landingsLoading}
            delta={
              landings?.previousTotals
                ? { current: totalLandings, previous: landings.previousTotals.landings }
                : null
            }
          />
          <KpiCard
            label={t('utm.signups')}
            value={signupsLoading ? null : totalSignups}
            loading={signupsLoading}
            delta={
              comparison
                ? { current: comparison.current.signups, previous: comparison.previous.signups }
                : null
            }
          />
          <KpiCard
            label={t('utm.conversionRate')}
            value={conversionRate != null ? `${(conversionRate * 100).toFixed(1)}%` : '—'}
            loading={landingsLoading || signupsLoading}
          />
          <KpiCard
            label={t('utm.topCampaign')}
            value={topCampaign ?? '—'}
            loading={signupsLoading}
          />
        </div>

        {/* Headline chart: clicks/day per campaign */}
        <div className="rounded-md border p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-medium m-0">{t('utm.topCampaignsTrend')}</p>
              <p className="text-xs text-muted-foreground m-0 mt-0.5">
                {t('utm.chartHint', { n: chartTopN })}
              </p>
            </div>
            <Select
              value={String(chartTopN)}
              onValueChange={v => setChartTopN(Number(v) as 5 | 10 | 20)}
            >
              <SelectTrigger className="h-8 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">{t('utm.topN', { n: 5 })}</SelectItem>
                <SelectItem value="10">{t('utm.topN', { n: 10 })}</SelectItem>
                <SelectItem value="20">{t('utm.topN', { n: 20 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {landingsLoading ? (
            <Skeleton className="h-[340px] w-full" />
          ) : chartSeries.length > 0 ? (
            <MultiSeriesAreaChart
              data={chartData}
              series={chartSeries}
              height={340}
              formatDay={day => formatDayLabel(day)}
            />
          ) : (
            <div className="h-[340px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground m-0">{t('utm.noUtmYet')}</p>
            </div>
          )}
        </div>

        <Tabs value={dimension} onValueChange={value => setDimension(value as Dimension)}>
          <TabsList>
            <TabsTrigger value="campaign">{t('utm.dimensions.campaign')}</TabsTrigger>
            <TabsTrigger value="source">{t('utm.dimensions.source')}</TabsTrigger>
            <TabsTrigger value="medium">{t('utm.dimensions.medium')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {landingsLoading || signupsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : aggregated.length === 0 ? (
          <p className="text-sm text-muted-foreground m-0">{t('utm.noUtmYet')}</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(`utm.dimensions.${dimension}`)}</TableHead>
                  <TableHead className="text-right">{t('utm.landings')}</TableHead>
                  <TableHead className="text-right">{t('utm.signups')}</TableHead>
                  <TableHead className="text-right">{t('utm.conversionRate')}</TableHead>
                  <TableHead className="text-right">{t('utm.matchesCreated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregated.map(row => {
                  const isSelected = drilldownKey === row.key;
                  const conv = row.landings > 0 ? row.signups / row.landings : null;
                  return (
                    <TableRow
                      key={row.key}
                      className={`cursor-pointer ${isSelected ? 'bg-muted/50' : ''}`}
                      onClick={() => setDrilldownKey(isSelected ? null : row.key)}
                    >
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right">{row.landings}</TableCell>
                      <TableCell className="text-right">{row.signups}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-xs">
                          {conv != null ? `${(conv * 100).toFixed(1)}%` : '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{row.matchesCreated}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {drilldownRow && (
          <div className="rounded-md border p-4">
            <p className="text-xs font-medium text-muted-foreground m-0 mb-2">
              {t('utm.drilldownTitle', { value: drilldownRow.label })}
            </p>
            <FunnelStrip
              stages={[
                { label: t('utm.funnel.landings'), value: drilldownRow.landings },
                { label: t('utm.funnel.signups'), value: drilldownRow.signups },
                { label: t('utm.funnel.firstMatch'), value: drilldownRow.matchesCreated },
                { label: t('utm.funnel.firstMatchPlayed'), value: drilldownRow.matchesPlayed },
              ]}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface AggregatedRow {
  key: string;
  label: string;
  landings: number;
  signups: number;
  matchesCreated: number;
  matchesPlayed: number;
}

function useAggregated(
  landings: UtmLandingsResponse | null,
  signups: UtmSignupStat[],
  dimension: Dimension
): AggregatedRow[] {
  return useMemo(() => {
    const map = new Map<string, AggregatedRow>();

    const ensure = (key: string): AggregatedRow => {
      const existing = map.get(key);
      if (existing) return existing;
      const fresh: AggregatedRow = {
        key,
        label: key,
        landings: 0,
        signups: 0,
        matchesCreated: 0,
        matchesPlayed: 0,
      };
      map.set(key, fresh);
      return fresh;
    };

    for (const row of landings?.landings ?? []) {
      const key = row[dimension];
      ensure(key).landings += row.count;
    }
    for (const row of signups) {
      const key = row[dimension];
      const r = ensure(key);
      r.signups += row.signups;
      r.matchesCreated += row.matchesCreated;
      r.matchesPlayed += row.matchesPlayed;
    }

    return Array.from(map.values()).sort((a, b) => {
      const byLandings = b.landings - a.landings;
      if (byLandings !== 0) return byLandings;
      return b.signups - a.signups;
    });
  }, [landings, signups, dimension]);
}

function useTopCampaign(signups: UtmSignupStat[]): string | null {
  return useMemo(() => {
    if (signups.length === 0) return null;
    const sorted = [...signups].sort((a, b) => b.signups - a.signups);
    return sorted[0]?.campaign ?? null;
  }, [signups]);
}

function useChartData(landings: UtmLandingsResponse | null): ChartPoint[] {
  return useMemo(() => {
    const rows = landings?.timeseries ?? [];
    if (rows.length === 0) return [];
    const byDay = new Map<string, ChartPoint>();
    for (const r of rows) {
      const point = byDay.get(r.day) ?? { day: r.day };
      point[r.campaign] = r.landings;
      byDay.set(r.day, point);
    }
    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [landings]);
}

function useChartSeries(landings: UtmLandingsResponse | null, limit: number): ChartSeries[] {
  return useMemo(() => {
    const rows = landings?.timeseries ?? [];
    const totals = new Map<string, number>();
    for (const r of rows) {
      totals.set(r.campaign, (totals.get(r.campaign) ?? 0) + r.landings);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map((entry, i) => ({
        name: entry[0],
        label: entry[0],
        colorIndex: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      }));
  }, [landings, limit]);
}

function formatDayLabel(day: string): string {
  try {
    const d = new Date(day);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return day;
  }
}
