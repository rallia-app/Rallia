'use client';

import { useCompatSupplySnapshot, useCompatSupplyTrend } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { KpiCard } from '@/components/admin/kpi-card';
import {
  MultiSeriesAreaChart,
  type ChartPoint,
  type ChartSeries,
} from '@/components/admin/multi-series-area-chart';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const DAY_OPTIONS = [30, 90] as const;
type DaysWindow = (typeof DAY_OPTIONS)[number];
const GOAL_ORDER = ['1', '2', '3', '4', '5', 'none'] as const;

const fmtNum = (v: number | null, suffix = '') => (v != null ? `${v}${suffix}` : '—');

export function CompatibilityTab() {
  const t = useTranslations('admin.analytics');
  const [view, setView] = useState<'snapshot' | 'trend'>('snapshot');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold m-0">{t('compat.title')}</h2>
          <p className="text-sm text-muted-foreground m-0 mt-1">{t('compat.description')}</p>
        </div>
        <Tabs value={view} onValueChange={v => setView(v as 'snapshot' | 'trend')}>
          <TabsList className="h-8">
            <TabsTrigger value="snapshot" className="text-xs">
              {t('compat.viewSnapshot')}
            </TabsTrigger>
            <TabsTrigger value="trend" className="text-xs">
              {t('compat.viewTrend')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === 'snapshot' ? <SnapshotView /> : <TrendView />}
    </div>
  );
}

function SnapshotView() {
  const t = useTranslations('admin.analytics');
  const { data, loading } = useCompatSupplySnapshot();

  const all = useMemo(() => data.find(d => d.goalBucket === 'all') ?? null, [data]);
  const byGoal = useMemo(
    () =>
      [...data]
        .filter(d => d.goalBucket !== 'all')
        .sort(
          (a, b) =>
            GOAL_ORDER.indexOf(a.goalBucket as never) - GOAL_ORDER.indexOf(b.goalBucket as never)
        ),
    [data]
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (!all || all.players === 0) {
    return <p className="text-sm text-muted-foreground m-0">{t('compat.noData')}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={t('compat.kpiDensity')}
          value={fmtNum(all.densityMedian)}
          hint={t('compat.kpiDensityHint', { mean: fmtNum(all.densityMean) })}
        />
        <KpiCard
          label={t('compat.kpiIsolated')}
          value={fmtNum(all.pctZeroDensity, '%')}
          hint={t('compat.kpiIsolatedHint')}
        />
        <KpiCard
          label={t('compat.kpiPlayedCompatible')}
          value={fmtNum(all.pctPlayedCompatible, '%')}
          hint={t('compat.kpiPlayedCompatibleHint')}
        />
        <KpiCard
          label={t('compat.kpiRealization')}
          value={fmtNum(all.realizationPct, '%')}
          hint={t('compat.kpiRealizationHint')}
        />
      </div>

      {/* Hypothetical vs actual */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('compat.hypoActualTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground m-0 mt-1">{t('compat.hypoActualHint')}</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-semibold">{fmtNum(all.compatibleMedian)}</div>
              <div className="text-[11px] text-muted-foreground">{t('compat.hypoCompatible')}</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{fmtNum(all.playedCompatibleMean)}</div>
              <div className="text-[11px] text-muted-foreground">{t('compat.actualPlayed')}</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-rose-500">
                {fmtNum(all.realizationPct, '%')}
              </div>
              <div className="text-[11px] text-muted-foreground">{t('compat.realized')}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* By weekly goal */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('compat.byGoalTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1.5 font-medium">{t('compat.colGoal')}</th>
                  <th className="py-1.5 font-medium text-right">{t('compat.colPlayers')}</th>
                  <th className="py-1.5 font-medium text-right">{t('compat.colDensity')}</th>
                  <th className="py-1.5 font-medium text-right">{t('compat.colCompatible')}</th>
                  <th className="py-1.5 font-medium text-right">{t('compat.colPlayed')}</th>
                  <th className="py-1.5 font-medium text-right">{t('compat.colRealization')}</th>
                </tr>
              </thead>
              <tbody>
                {byGoal.map(r => (
                  <tr key={r.goalBucket} className="border-b last:border-0">
                    <td className="py-1.5">
                      {r.goalBucket === 'none' ? t('compat.goalNone') : `${r.goalBucket}×`}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{r.players}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtNum(r.densityMedian)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtNum(r.compatibleMedian)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtNum(r.pctPlayedCompatible, '%')}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtNum(r.realizationPct, '%')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TrendView() {
  const t = useTranslations('admin.analytics');
  const [days, setDays] = useState<DaysWindow>(90);
  const { data, loading } = useCompatSupplyTrend(days);

  const points = useMemo<ChartPoint[]>(() => {
    const byDay = new Map<string, ChartPoint>();
    for (const s of data) {
      const day = s.snapshotDate;
      const point = byDay.get(day) ?? ({ day } as ChartPoint);
      point[s.metricName] = s.metricValue;
      byDay.set(day, point);
    }
    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [data]);

  const series: ChartSeries[] = [
    { name: 'density_median', label: t('compat.seriesDensity'), colorIndex: 1 },
    { name: 'pct_played_compatible', label: t('compat.seriesPlayed'), colorIndex: 2 },
    { name: 'realization_pct', label: t('compat.seriesRealization'), colorIndex: 3 },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t('compat.trendTitle')}</CardTitle>
            <p className="text-xs text-muted-foreground m-0 mt-1">{t('compat.trendHint')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground shrink-0">{t('utm.timeWindow')}</Label>
            <Select value={String(days)} onValueChange={v => setDays(Number(v) as DaysWindow)}>
              <SelectTrigger className="h-8 w-[150px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map(o => (
                  <SelectItem key={o} value={String(o)}>
                    {t(`timeRange.${o}d`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : points.length < 2 ? (
          <p className="text-sm text-muted-foreground m-0">{t('compat.trendEmpty')}</p>
        ) : (
          <MultiSeriesAreaChart
            data={points}
            series={series}
            height={260}
            formatDay={d => d.slice(5)}
          />
        )}
      </CardContent>
    </Card>
  );
}
