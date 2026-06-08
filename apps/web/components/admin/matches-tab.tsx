'use client';

import { useMatchQualityAnalytics, type MatchQualityPoint } from '@rallia/shared-hooks';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const DAY_OPTIONS = [7, 30, 90] as const;
type DaysWindow = (typeof DAY_OPTIONS)[number];

const SEGMENTS = ['all', 'auto', 'nonAuto'] as const;
type Segment = (typeof SEGMENTS)[number];
const SEGMENT_LABEL: Record<Segment, string> = {
  all: 'matchesTab.segmentAll',
  auto: 'matchesTab.sourceAuto',
  nonAuto: 'matchesTab.sourceOrganic',
};

export function MatchesTab() {
  const t = useTranslations('admin.analytics');
  const [days, setDays] = useState<DaysWindow>(30);

  const { data, loading } = useMatchQualityAnalytics(days);

  const { totals, autoTotals, nonAutoTotals, bySport, bySource } = useMemo(
    () => aggregate(data),
    [data]
  );
  const [segment, setSegment] = useState<Segment>('all');
  const funnelTotals =
    segment === 'auto' ? autoTotals : segment === 'nonAuto' ? nonAutoTotals : totals;
  const funnelCoverage =
    funnelTotals.feedbackExpected > 0
      ? (funnelTotals.feedbackPresent / funnelTotals.feedbackExpected) * 100
      : null;
  const chart = useCreatedVsQualityChart(data, t);

  const qualityRate = totals.played > 0 ? (totals.quality / totals.played) * 100 : null;
  const avgRating = totals.ratingCount > 0 ? totals.ratingSum / totals.ratingCount : null;
  const coverage =
    totals.feedbackExpected > 0 ? (totals.feedbackPresent / totals.feedbackExpected) * 100 : null;

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

      {/* KPI strip — quality game north star */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label={t('matchesTab.qualityGames')}
          value={loading ? null : totals.quality}
          hint={t('matchesTab.qualityGamesHint')}
          loading={loading}
        />
        <KpiCard
          label={t('matchesTab.qualityRate')}
          value={qualityRate != null ? `${qualityRate.toFixed(0)}%` : '—'}
          hint={t('matchesTab.qualityRateHint', { quality: totals.quality, played: totals.played })}
          loading={loading}
        />
        <KpiCard
          label={t('matchesTab.played')}
          value={loading ? null : totals.played}
          hint={t('matchesTab.playedHint')}
          loading={loading}
        />
        <KpiCard
          label={t('matchesTab.avgRating')}
          value={avgRating != null ? avgRating.toFixed(1) : '—'}
          loading={loading}
        />
        <KpiCard
          label={t('matchesTab.feedbackCoverage')}
          value={coverage != null ? `${coverage.toFixed(0)}%` : '—'}
          hint={t('matchesTab.feedbackCoverageHint', {
            present: totals.feedbackPresent,
            expected: totals.feedbackExpected,
          })}
          loading={loading}
        />
      </div>

      {/* Lifecycle funnel — segmented by match source */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t('matchesTab.funnelTitle')}</CardTitle>
              <p className="text-xs text-muted-foreground m-0 mt-1">{t('matchesTab.funnelHint')}</p>
            </div>
            <Tabs value={segment} onValueChange={v => setSegment(v as Segment)}>
              <TabsList className="h-8">
                {SEGMENTS.map(s => (
                  <TabsTrigger key={s} value={s} className="text-xs">
                    {t(SEGMENT_LABEL[s])}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : funnelTotals.created === 0 ? (
            <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
          ) : (
            <Funnel totals={funnelTotals} coverage={funnelCoverage} t={t} />
          )}
        </CardContent>
      </Card>

      {/* Played vs quality over time */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('matchesTab.chartTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground m-0 mt-1">{t('matchesTab.chartHint')}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chart.hasData ? (
            <MultiSeriesAreaChart
              data={chart.chartData}
              series={chart.chartSeries}
              height={300}
              formatDay={formatDayLabel}
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quality drop-off diagnostic */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('matchesTab.dropoffTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground m-0 mt-1">
            {t('matchesTab.dropoffHint', { played: totals.played })}
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : totals.played === 0 ? (
            <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
          ) : (
            <div className="space-y-3">
              {(
                [
                  { label: t('matchesTab.dropNoShow'), count: totals.playedNoShow },
                  { label: t('matchesTab.dropLate'), count: totals.playedLate },
                  { label: t('matchesTab.dropLowRating'), count: totals.playedLowRating },
                  { label: t('matchesTab.dropReported'), count: totals.playedReported },
                ] as const
              ).map(row => (
                <BarRow
                  key={row.label}
                  label={row.label}
                  count={row.count}
                  total={totals.played}
                  tone="rose"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-sport breakdown */}
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
                    <TableHead>{t('matchesTab.colSport')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.colPlayed')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.colQuality')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.colRate')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.colAvgRating')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bySport.map(row => {
                    const rate =
                      row.played > 0 ? ((row.quality / row.played) * 100).toFixed(0) : '—';
                    const rating =
                      row.ratingCount > 0 ? (row.ratingSum / row.ratingCount).toFixed(1) : '—';
                    return (
                      <TableRow key={row.sportId}>
                        <TableCell className="font-medium">{row.sportName}</TableCell>
                        <TableCell className="text-right">{row.played}</TableCell>
                        <TableCell className="text-right">{row.quality}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="text-xs">
                            {rate !== '—' ? `${rate}%` : rate}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{rating}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-matched vs organic */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('matchesTab.sourceTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : totals.played === 0 ? (
            <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('matchesTab.sourceTitle')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.colPlayed')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.colQuality')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.colRate')}</TableHead>
                    <TableHead className="text-right">{t('matchesTab.colAvgRating')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      { label: t('matchesTab.sourceAuto'), agg: bySource.auto },
                      { label: t('matchesTab.sourceOrganic'), agg: bySource.organic },
                    ] as const
                  ).map(row => {
                    const rate =
                      row.agg.played > 0
                        ? ((row.agg.quality / row.agg.played) * 100).toFixed(0)
                        : '—';
                    const rating =
                      row.agg.ratingCount > 0
                        ? (row.agg.ratingSum / row.agg.ratingCount).toFixed(1)
                        : '—';
                    return (
                      <TableRow key={row.label}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className="text-right">{row.agg.played}</TableCell>
                        <TableCell className="text-right">{row.agg.quality}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="text-xs">
                            {rate !== '—' ? `${rate}%` : rate}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{rating}</TableCell>
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
// Funnel
// ---------------------------------------------------------------------------

function Funnel({
  totals,
  coverage,
  t,
}: {
  totals: Totals;
  coverage: number | null;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const stages: FunnelStage[] = [
    {
      key: 'created',
      label: t('matchesTab.stageCreated'),
      count: totals.created,
      feedbackDep: false,
    },
    { key: 'filled', label: t('matchesTab.stageFilled'), count: totals.filled, feedbackDep: false },
    { key: 'played', label: t('matchesTab.stagePlayed'), count: totals.played, feedbackDep: true },
    {
      key: 'feedback',
      label: t('matchesTab.stageAllFeedback'),
      count: totals.allFeedback,
      feedbackDep: true,
    },
    {
      key: 'quality',
      label: t('matchesTab.stageQuality'),
      count: totals.quality,
      feedbackDep: true,
    },
  ];

  // Check-in is a geofenced/optional action, so it sits beside the funnel as an
  // adoption stat rather than on the critical path to a quality game.
  const checkedInPct = totals.filled > 0 ? (totals.allCheckedIn / totals.filled) * 100 : null;

  const outcomes = [
    { label: t('matchesTab.outcomeFellThrough'), count: totals.fellThrough },
    { label: t('matchesTab.outcomeCancelled'), count: totals.cancelled },
    { label: t('matchesTab.outcomeMutualCancel'), count: totals.mutualCancel },
    { label: t('matchesTab.outcomePending'), count: totals.pending },
  ];

  return (
    <div className="flex flex-col gap-4">
      <FunnelBars stages={stages} baseline={totals.created} t={t} />

      {checkedInPct != null && (
        <p className="text-[11px] text-muted-foreground m-0">
          {t('matchesTab.checkedInStat', {
            count: totals.allCheckedIn.toLocaleString(),
            pct: checkedInPct.toFixed(0),
          })}
        </p>
      )}

      {/* Where the unplayed games went */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t('matchesTab.outcomesTitle')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {outcomes.map(o => (
            <Badge key={o.label} variant="outline" className="text-[11px] font-normal">
              {o.label}: {o.count.toLocaleString()}
            </Badge>
          ))}
        </div>
      </div>

      {coverage != null && (
        <p className="text-[11px] text-muted-foreground m-0">
          {t('matchesTab.funnelConfidence', { pct: coverage.toFixed(0) })}
        </p>
      )}
    </div>
  );
}

interface FunnelStage {
  key: string;
  label: string;
  count: number;
  // Confirmation-dependent stages render as a "floor" (lighter bar).
  feedbackDep: boolean;
}

function FunnelBars({
  stages,
  baseline,
  t,
}: {
  stages: FunnelStage[];
  baseline: number;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="space-y-3">
      {stages.map(s => {
        const pct = baseline > 0 ? (s.count / baseline) * 100 : 0;
        return (
          <div key={s.key}>
            <div className="flex items-baseline justify-between text-xs mb-1">
              <span className="font-medium">{s.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {s.count.toLocaleString()} · {t('matchesTab.funnelOf', { pct: pct.toFixed(0) })}
              </span>
            </div>
            <div className="h-2.5 rounded bg-muted overflow-hidden">
              <div
                className={s.feedbackDep ? 'h-full bg-primary/55' : 'h-full bg-primary'}
                style={{ width: `${Math.max(pct, s.count > 0 ? 1.5 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: 'rose' | 'primary';
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const barClass = tone === 'rose' ? 'h-full bg-rose-500/70' : 'h-full bg-primary';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {count.toLocaleString()} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 rounded bg-muted overflow-hidden">
        <div className={barClass} style={{ width: `${Math.max(pct, count > 0 ? 1.5 : 0)}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Totals {
  created: number;
  filled: number;
  allCheckedIn: number;
  allFeedback: number;
  played: number;
  quality: number;
  cancelled: number;
  mutualCancel: number;
  fellThrough: number;
  pending: number;
  playedNoShow: number;
  playedLate: number;
  playedLowRating: number;
  playedReported: number;
  ratingSum: number;
  ratingCount: number;
  feedbackExpected: number;
  feedbackPresent: number;
}

interface SportAggregate {
  sportId: string;
  sportName: string;
  played: number;
  quality: number;
  ratingSum: number;
  ratingCount: number;
}

interface SourceAggregate {
  played: number;
  quality: number;
  ratingSum: number;
  ratingCount: number;
}

function emptyTotals(): Totals {
  return {
    created: 0,
    filled: 0,
    allCheckedIn: 0,
    allFeedback: 0,
    played: 0,
    quality: 0,
    cancelled: 0,
    mutualCancel: 0,
    fellThrough: 0,
    pending: 0,
    playedNoShow: 0,
    playedLate: 0,
    playedLowRating: 0,
    playedReported: 0,
    ratingSum: 0,
    ratingCount: 0,
    feedbackExpected: 0,
    feedbackPresent: 0,
  };
}

function addToTotals(t: Totals, row: MatchQualityPoint): void {
  t.created += row.matchesCreated;
  t.filled += row.matchesFilled;
  t.allCheckedIn += row.matchesAllCheckedIn;
  t.allFeedback += row.matchesAllFeedback;
  t.played += row.matchesPlayed;
  t.quality += row.matchesQuality;
  t.cancelled += row.matchesCancelled;
  t.mutualCancel += row.matchesMutualCancel;
  t.fellThrough += row.matchesFellThrough;
  t.pending += row.matchesPending;
  t.playedNoShow += row.playedNoShow;
  t.playedLate += row.playedLate;
  t.playedLowRating += row.playedLowRating;
  t.playedReported += row.playedReported;
  t.ratingSum += row.ratingSum;
  t.ratingCount += row.ratingCount;
  t.feedbackExpected += row.feedbackExpected;
  t.feedbackPresent += row.feedbackPresent;
}

function aggregate(data: MatchQualityPoint[]): {
  totals: Totals;
  autoTotals: Totals;
  nonAutoTotals: Totals;
  bySport: SportAggregate[];
  bySource: { auto: SourceAggregate; organic: SourceAggregate };
} {
  const totals = emptyTotals();
  const autoTotals = emptyTotals();
  const nonAutoTotals = emptyTotals();
  const sportMap = new Map<string, SportAggregate>();
  const auto: SourceAggregate = { played: 0, quality: 0, ratingSum: 0, ratingCount: 0 };
  const organic: SourceAggregate = { played: 0, quality: 0, ratingSum: 0, ratingCount: 0 };

  for (const row of data) {
    addToTotals(totals, row);
    if (row.isAutoGenerated) addToTotals(autoTotals, row);
    else addToTotals(nonAutoTotals, row);

    const sport = sportMap.get(row.sportId);
    if (sport) {
      sport.played += row.matchesPlayed;
      sport.quality += row.matchesQuality;
      sport.ratingSum += row.ratingSum;
      sport.ratingCount += row.ratingCount;
    } else {
      sportMap.set(row.sportId, {
        sportId: row.sportId,
        sportName: row.sportName,
        played: row.matchesPlayed,
        quality: row.matchesQuality,
        ratingSum: row.ratingSum,
        ratingCount: row.ratingCount,
      });
    }

    const bucket = row.isAutoGenerated ? auto : organic;
    bucket.played += row.matchesPlayed;
    bucket.quality += row.matchesQuality;
    bucket.ratingSum += row.ratingSum;
    bucket.ratingCount += row.ratingCount;
  }

  return {
    totals,
    autoTotals,
    nonAutoTotals,
    bySport: Array.from(sportMap.values())
      .filter(s => s.played > 0 || s.quality > 0)
      .sort((a, b) => b.played - a.played),
    bySource: { auto, organic },
  };
}

// ---------------------------------------------------------------------------
// Chart: played vs quality per day (aggregated across sports)
// ---------------------------------------------------------------------------

function useCreatedVsQualityChart(
  data: MatchQualityPoint[],
  t: (key: string) => string
): { chartData: ChartPoint[]; chartSeries: ChartSeries[]; hasData: boolean } {
  return useMemo(() => {
    const chartSeries: ChartSeries[] = [
      { name: 'played', label: t('matchesTab.seriesPlayed'), colorIndex: 3 },
      { name: 'quality', label: t('matchesTab.seriesQuality'), colorIndex: 1 },
    ];

    if (data.length === 0) return { chartData: [], chartSeries, hasData: false };

    const byDay = new Map<string, { played: number; quality: number }>();
    for (const row of data) {
      const point = byDay.get(row.date) ?? { played: 0, quality: 0 };
      point.played += row.matchesPlayed;
      point.quality += row.matchesQuality;
      byDay.set(row.date, point);
    }

    const chartData: ChartPoint[] = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, played: v.played, quality: v.quality }));

    const hasData = chartData.some(p => (p.played as number) > 0 || (p.quality as number) > 0);
    return { chartData, chartSeries, hasData };
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
