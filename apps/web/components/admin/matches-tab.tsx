'use client';

import { useMatchFillAnalytics, useMatchStats, type MatchFillPoint } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { KpiCard } from '@/components/admin/kpi-card';
import {
  MultiSeriesAreaChart,
  type ChartPoint,
  type ChartSeries,
} from '@/components/admin/multi-series-area-chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const DAY_OPTIONS = [7, 30, 90] as const;
type DaysWindow = (typeof DAY_OPTIONS)[number];

export function MatchesTab() {
  const t = useTranslations('admin.analytics');
  const [days, setDays] = useState<DaysWindow>(30);

  const { data: fillData, loading: fillLoading } = useMatchFillAnalytics(days);
  const { stats: matchStats, loading: statsLoading } = useMatchStats({ days });

  const loading = fillLoading || statsLoading;

  const { totals, bySport } = useMemo(() => aggregateFillData(fillData), [fillData]);
  const { chartData, chartSeries } = useCreatedVsFilledChart(fillData, t);

  const fillRate = totals.created > 0 ? ((totals.filled / totals.created) * 100).toFixed(1) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Time window selector */}
      <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <Label className="text-xs text-muted-foreground">{t('utm.timeWindow')}</Label>
        <Select value={String(days)} onValueChange={v => setDays(Number(v) as DaysWindow)}>
          <SelectTrigger className="h-8 w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_OPTIONS.map(option => (
              <SelectItem key={option} value={String(option)}>
                {t(`timeRange.${option}d`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={t('matchesTab.totalCreated')}
          value={loading ? null : totals.created}
          loading={loading}
        />
        <KpiCard
          label={t('matchesTab.totalFilled')}
          value={loading ? null : totals.filled}
          loading={loading}
        />
        <KpiCard
          label={t('matchesTab.fillRate')}
          value={fillRate != null ? `${fillRate}%` : '—'}
          hint={
            totals.created > 0
              ? t('matchesTab.fillRateHint', {
                  filled: totals.filled,
                  created: totals.created,
                })
              : undefined
          }
          loading={loading}
        />
        <KpiCard
          label={t('matchesTab.avgParticipants')}
          value={statsLoading ? null : (matchStats?.avgParticipants ?? '—')}
          loading={statsLoading}
        />
      </div>

      {/* Created vs filled chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('matchesTab.chartTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground m-0 mt-1">{t('matchesTab.chartHint')}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
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
              <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-sport summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('matchesTab.sportBreakdown')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : bySport.length === 0 ? (
            <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sport</TableHead>
                    <TableHead className="text-right">{t('matchesTab.created')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.filled')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.rate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bySport.map(row => {
                    const rate =
                      row.created > 0 ? ((row.filled / row.created) * 100).toFixed(1) : '—';
                    return (
                      <TableRow key={row.sportId}>
                        <TableCell className="font-medium">{row.sportName}</TableCell>
                        <TableCell className="text-right">{row.created}</TableCell>
                        <TableCell className="text-right">{row.filled}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="text-xs">
                            {rate !== '—' ? `${rate}%` : rate}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SportAggregate {
  sportId: string;
  sportName: string;
  created: number;
  filled: number;
}

function aggregateFillData(data: MatchFillPoint[]): {
  totals: { created: number; filled: number };
  bySport: SportAggregate[];
} {
  const map = new Map<string, SportAggregate>();
  let totalCreated = 0;
  let totalFilled = 0;

  for (const row of data) {
    totalCreated += row.matchesCreated;
    totalFilled += row.matchesFilled;

    const existing = map.get(row.sportId);
    if (existing) {
      existing.created += row.matchesCreated;
      existing.filled += row.matchesFilled;
    } else {
      map.set(row.sportId, {
        sportId: row.sportId,
        sportName: row.sportName,
        created: row.matchesCreated,
        filled: row.matchesFilled,
      });
    }
  }

  return {
    totals: { created: totalCreated, filled: totalFilled },
    bySport: Array.from(map.values()).sort((a, b) => b.created - a.created),
  };
}

const SPORT_COLORS: Record<string, { created: 1 | 2 | 3 | 4 | 5; filled: 1 | 2 | 3 | 4 | 5 }> = {};
let nextColorPair = 0;
const COLOR_PAIRS: [1 | 2 | 3 | 4 | 5, 1 | 2 | 3 | 4 | 5][] = [
  [1, 2],
  [3, 4],
  [5, 1],
];

function getColorPair(sportId: string): { created: 1 | 2 | 3 | 4 | 5; filled: 1 | 2 | 3 | 4 | 5 } {
  if (!SPORT_COLORS[sportId]) {
    const pair = COLOR_PAIRS[nextColorPair % COLOR_PAIRS.length];
    SPORT_COLORS[sportId] = { created: pair[0], filled: pair[1] };
    nextColorPair++;
  }
  return SPORT_COLORS[sportId];
}

function useCreatedVsFilledChart(
  data: MatchFillPoint[],
  t: (key: string) => string
): { chartData: ChartPoint[]; chartSeries: ChartSeries[] } {
  return useMemo(() => {
    if (data.length === 0) return { chartData: [], chartSeries: [] };

    const sports = new Map<string, string>();
    for (const row of data) {
      if (!sports.has(row.sportId)) sports.set(row.sportId, row.sportName);
    }

    const chartSeries: ChartSeries[] = [];
    for (const [sportId, sportName] of sports) {
      const colors = getColorPair(sportId);
      chartSeries.push({
        name: `${sportName}_created`,
        label: `${sportName} — ${t('matchesTab.created')}`,
        colorIndex: colors.created,
      });
      chartSeries.push({
        name: `${sportName}_filled`,
        label: `${sportName} — ${t('matchesTab.filled')}`,
        colorIndex: colors.filled,
      });
    }

    const byDay = new Map<string, ChartPoint>();
    for (const row of data) {
      const point = byDay.get(row.date) ?? ({ day: row.date } as ChartPoint);
      const createdKey = `${row.sportName}_created`;
      const filledKey = `${row.sportName}_filled`;
      point[createdKey] = ((point[createdKey] as number) || 0) + row.matchesCreated;
      point[filledKey] = ((point[filledKey] as number) || 0) + row.matchesFilled;
      byDay.set(row.date, point);
    }

    const chartData = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
    return { chartData, chartSeries };
  }, [data, t]);
}

function formatDayLabel(day: string): string {
  try {
    const d = new Date(day);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return day;
  }
}
