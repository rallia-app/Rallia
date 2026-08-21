'use client';

import { useMatchQualityAnalytics, type MatchQualityPoint } from '@rallia/shared-hooks';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import {
  daysCoveringLastNWeeks,
  lastNDayStarts,
  lastNWeekStarts,
  shortDayLabel,
  shortWeekLabel,
  weekStartOf,
} from './week-utils';
import { RateTrendChart, StackedFunnelChart, type TrendPoint } from './weekly-trend-charts';

import { AutoInviteFunnel } from '@/components/admin/auto-invite-funnel';
import { InsightCardHeader, SegmentedToggle } from '@/components/admin/insight-card';
import { WindowSelect } from '@/components/admin/window-select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const DAY_OPTIONS = [7, 30, 90] as const;
type DaysWindow = (typeof DAY_OPTIONS)[number];

const VIEWS = ['lifecycle', 'autoInvites', 'feedback'] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  lifecycle: 'matchesTab.tabLifecycle',
  autoInvites: 'matchesTab.tabAutoInvites',
  feedback: 'matchesTab.tabFeedback',
};

const SEGMENTS = ['all', 'auto', 'organic'] as const;
type Segment = (typeof SEGMENTS)[number];
const SEGMENT_LABEL: Record<Segment, string> = {
  all: 'matchesTab.segmentAll',
  auto: 'matchesTab.sourceAuto',
  organic: 'matchesTab.sourceOrganic',
};

type FunnelView = 'cumulative' | 'weekly' | 'daily';

const VIEW_OPTIONS = (t: (key: string) => string): { value: FunnelView; label: string }[] => [
  { value: 'daily', label: t('matchesTab.viewDaily') },
  { value: 'weekly', label: t('matchesTab.viewWeekly') },
  { value: 'cumulative', label: t('matchesTab.viewCumulative') },
];

const WEEKS_SHOWN = 6;
const DAYS_SHOWN = 14;

export function MatchesTab() {
  const t = useTranslations('admin.analytics');
  const [view, setView] = useState<View>('lifecycle');

  // Each insight owns its own time window (rendered in its card header); there
  // is no shared/global window selector.
  return (
    <Tabs value={view} onValueChange={v => setView(v as View)}>
      <TabsList className="h-auto flex-wrap">
        {VIEWS.map(v => (
          <TabsTrigger key={v} value={v} className="text-xs">
            {t(VIEW_LABEL[v])}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="lifecycle">
        <LifecycleFunnelCard />
      </TabsContent>
      <TabsContent value="autoInvites">
        <AutoInviteFunnel />
      </TabsContent>
      <TabsContent value="feedback">
        <FeedbackCard />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle funnel — cumulative (windowed) + weekly cohort trend
// ---------------------------------------------------------------------------

function LifecycleFunnelCard() {
  const locale = useLocale();
  const t = useTranslations('admin.analytics');
  const [days, setDays] = useState<DaysWindow>(30);
  const [segment, setSegment] = useState<Segment>('all');
  const [funnelView, setFunnelView] = useState<FunnelView>('weekly');

  // Cumulative is window-bound; weekly covers the last 6 ISO weeks (through Sunday
  // so the current week shows); daily covers the last 14 days. Only the active
  // view fetches.
  const { data, loading } = useMatchQualityAnalytics(days, false, funnelView === 'cumulative');
  const { totals, autoTotals, nonAutoTotals } = useMemo(() => aggregate(data), [data]);
  const { data: weeklyData, loading: weeklyLoading } = useMatchQualityAnalytics(
    daysCoveringLastNWeeks(WEEKS_SHOWN),
    true,
    funnelView === 'weekly'
  );
  const { data: dailyData, loading: dailyLoading } = useMatchQualityAnalytics(
    DAYS_SHOWN,
    false,
    funnelView === 'daily'
  );
  const trendBuckets = useMemo(
    () =>
      funnelView === 'daily'
        ? aggregateBuckets(dailyData, segment, lastNDayStarts(DAYS_SHOWN), d => d)
        : aggregateBuckets(weeklyData, segment, lastNWeekStarts(WEEKS_SHOWN), weekStartOf),
    [funnelView, dailyData, weeklyData, segment]
  );

  const funnelTotals =
    segment === 'auto' ? autoTotals : segment === 'organic' ? nonAutoTotals : totals;
  const funnelCoverage =
    funnelTotals.feedbackExpected > 0
      ? (funnelTotals.feedbackPresent / funnelTotals.feedbackExpected) * 100
      : null;

  const isTrend = funnelView !== 'cumulative';
  const trendLoading = funnelView === 'daily' ? dailyLoading : weeklyLoading;
  const hintKey =
    funnelView === 'daily'
      ? 'matchesTab.dailyFunnelHint'
      : funnelView === 'weekly'
        ? 'matchesTab.weeklyFunnelHint'
        : 'matchesTab.funnelHint';

  return (
    <Card>
      <InsightCardHeader
        title={t('matchesTab.funnelTitle')}
        hint={t(hintKey)}
        controls={
          <>
            <SegmentedToggle
              value={segment}
              onChange={v => setSegment(v as Segment)}
              options={SEGMENTS.map(s => ({ value: s, label: t(SEGMENT_LABEL[s]) }))}
            />
            <SegmentedToggle
              value={funnelView}
              onChange={v => setFunnelView(v as FunnelView)}
              options={VIEW_OPTIONS(t)}
            />
            {funnelView === 'cumulative' && (
              <WindowSelect
                value={days}
                onChange={d => setDays(d as DaysWindow)}
                options={DAY_OPTIONS}
              />
            )}
          </>
        }
      />
      <CardContent>
        {(isTrend ? trendLoading : loading) ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isTrend ? (
          trendBuckets.some(b => b.totals.created > 0) ? (
            <TrendFunnels
              buckets={trendBuckets}
              labelOf={s =>
                funnelView === 'daily' ? shortDayLabel(s, locale) : shortWeekLabel(s, locale)
              }
              progressNote={t(
                funnelView === 'daily'
                  ? 'matchesTab.dailyInProgress'
                  : 'matchesTab.weeklyInProgress'
              )}
              t={t}
            />
          ) : (
            <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
          )
        ) : funnelTotals.created === 0 ? (
          <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
        ) : (
          <Funnel totals={funnelTotals} coverage={funnelCoverage} t={t} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Feedback — per-step participant completion (cumulative + weekly)
// ---------------------------------------------------------------------------

function FeedbackCard() {
  const locale = useLocale();
  const t = useTranslations('admin.analytics');
  const [days, setDays] = useState<DaysWindow>(30);
  const [view, setView] = useState<FunnelView>('weekly');

  // Only the active view fetches; weekly covers the last 6 ISO weeks, daily the
  // last 14 days.
  const { data, loading } = useMatchQualityAnalytics(days, false, view === 'cumulative');
  const { totals } = useMemo(() => aggregate(data), [data]);
  const { data: weeklyData, loading: weeklyLoading } = useMatchQualityAnalytics(
    daysCoveringLastNWeeks(WEEKS_SHOWN),
    true,
    view === 'weekly'
  );
  const { data: dailyData, loading: dailyLoading } = useMatchQualityAnalytics(
    DAYS_SHOWN,
    false,
    view === 'daily'
  );
  const trendBuckets = useMemo(
    () =>
      view === 'daily'
        ? aggregateBuckets(dailyData, 'all', lastNDayStarts(DAYS_SHOWN), d => d)
        : aggregateBuckets(weeklyData, 'all', lastNWeekStarts(WEEKS_SHOWN), weekStartOf),
    [view, dailyData, weeklyData]
  );

  // Each post-match step as a share of expected participants (closed matches).
  // Not strictly nested — check-in happens before the others — so these are
  // completion rates, not a funnel.
  const steps = [
    { label: t('matchesTab.stepCheckedIn'), count: totals.feedbackCheckedIn },
    { label: t('matchesTab.stepReported'), count: totals.feedbackPresent },
    { label: t('matchesTab.stepRated'), count: totals.feedbackRated },
    { label: t('matchesTab.stepDone'), count: totals.feedbackDone },
  ] as const;

  const labelOf = (s: string) =>
    view === 'daily' ? shortDayLabel(s, locale) : shortWeekLabel(s, locale);
  const trendPoints: TrendPoint[] = trendBuckets.map(({ start, totals: bt }) => {
    const e = bt.feedbackExpected;
    return {
      bucket: labelOf(start),
      expected: e,
      reported: e > 0 ? Math.round((bt.feedbackPresent / e) * 100) : 0,
      done: e > 0 ? Math.round((bt.feedbackDone / e) * 100) : 0,
    };
  });

  const isTrend = view !== 'cumulative';
  const trendLoading = view === 'daily' ? dailyLoading : weeklyLoading;
  const hintKey =
    view === 'daily'
      ? 'matchesTab.feedbackDailyHint'
      : view === 'weekly'
        ? 'matchesTab.feedbackWeeklyHint'
        : 'matchesTab.feedbackHint';

  return (
    <Card>
      <InsightCardHeader
        title={t('matchesTab.feedbackTitle')}
        hint={t(hintKey, { expected: totals.feedbackExpected })}
        controls={
          <>
            <SegmentedToggle
              value={view}
              onChange={v => setView(v as FunnelView)}
              options={VIEW_OPTIONS(t)}
            />
            {view === 'cumulative' && (
              <WindowSelect
                value={days}
                onChange={d => setDays(d as DaysWindow)}
                options={DAY_OPTIONS}
              />
            )}
          </>
        }
      />
      <CardContent>
        {(isTrend ? trendLoading : loading) ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : isTrend ? (
          trendBuckets.some(b => b.totals.feedbackExpected > 0) ? (
            <div className="flex flex-col gap-3">
              <RateTrendChart
                data={trendPoints}
                xKey="bucket"
                volumeKey="expected"
                volumeLabel={t('matchesTab.feedbackExpectedLabel')}
                series={[
                  { key: 'reported', label: t('matchesTab.stepReported'), color: 'var(--chart-1)' },
                  {
                    key: 'done',
                    label: t('matchesTab.stepDone'),
                    color: 'var(--chart-2)',
                    dash: '5 3',
                  },
                ]}
              />
              <p className="text-[11px] text-muted-foreground m-0">
                {t(view === 'daily' ? 'matchesTab.dailyInProgress' : 'matchesTab.weeklyInProgress')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
          )
        ) : totals.feedbackExpected === 0 ? (
          <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
        ) : (
          <div className="space-y-3">
            {steps.map(s => (
              <BarRow
                key={s.label}
                label={s.label}
                count={s.count}
                total={totals.feedbackExpected}
                tone="primary"
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
      description: t('matchesTab.stageCreatedDesc'),
      count: totals.created,
      feedbackDep: false,
    },
    {
      key: 'filled',
      label: t('matchesTab.stageFilled'),
      description: t('matchesTab.stageFilledDesc'),
      count: totals.filled,
      feedbackDep: false,
    },
    {
      key: 'played',
      label: t('matchesTab.stagePlayed'),
      description: t('matchesTab.stagePlayedDesc'),
      count: totals.played,
      feedbackDep: true,
    },
    {
      key: 'quality',
      label: t('matchesTab.stageQuality'),
      description: t('matchesTab.stageQualityDesc'),
      count: totals.quality,
      feedbackDep: true,
    },
  ];

  // Full check-in and full feedback are data-completeness signals, not lifecycle
  // gates toward a quality game, so they sit beside the funnel as health stats.
  const checkedInPct = totals.filled > 0 ? (totals.allCheckedIn / totals.filled) * 100 : null;
  const feedbackPct = totals.filled > 0 ? (totals.allFeedback / totals.filled) * 100 : null;

  const outcomes = [
    { label: t('matchesTab.outcomeFellThrough'), count: totals.fellThrough },
    { label: t('matchesTab.outcomeCancelled'), count: totals.cancelled },
    { label: t('matchesTab.outcomeMutualCancel'), count: totals.mutualCancel },
    { label: t('matchesTab.outcomePending'), count: totals.pending },
  ];

  return (
    <div className="flex flex-col gap-4">
      <FunnelBars stages={stages} baseline={totals.created} t={t} />

      {(checkedInPct != null || feedbackPct != null) && (
        <div className="flex flex-col gap-1">
          {checkedInPct != null && (
            <p className="text-[11px] text-muted-foreground m-0">
              {t('matchesTab.checkedInStat', {
                count: totals.allCheckedIn.toLocaleString(),
                pct: checkedInPct.toFixed(0),
              })}
            </p>
          )}
          {feedbackPct != null && (
            <p className="text-[11px] text-muted-foreground m-0">
              {t('matchesTab.feedbackStat', {
                count: totals.allFeedback.toLocaleString(),
                pct: feedbackPct.toFixed(0),
              })}
            </p>
          )}
        </div>
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
  // Muted one-liner explaining what the bucket counts.
  description: string;
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
            <div className="flex items-baseline justify-between gap-3 text-xs mb-0.5">
              <span className="font-medium">{s.label}</span>
              <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                {s.count.toLocaleString()} · {t('matchesTab.funnelOf', { pct: pct.toFixed(0) })}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground m-0 mb-1">{s.description}</p>
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

// ---------------------------------------------------------------------------
// Trend cohort view — one mini funnel per bucket (ISO week or calendar day)
// ---------------------------------------------------------------------------

interface TrendBucket {
  start: string;
  totals: Totals;
}

/** Bucket daily rows into the given zero-filled bucket starts; rows outside drop. */
function aggregateBuckets(
  data: MatchQualityPoint[],
  segment: Segment,
  starts: string[],
  keyOf: (date: string) => string
): TrendBucket[] {
  const map = new Map<string, Totals>(starts.map(s => [s, emptyTotals()]));
  for (const row of data) {
    if (segment === 'auto' && !row.isAutoGenerated) continue;
    if (segment === 'organic' && row.isAutoGenerated) continue;
    const totals = map.get(keyOf(row.date));
    if (!totals) continue;
    addToTotals(totals, row);
  }
  return Array.from(map.entries()).map(([start, totals]) => ({ start, totals }));
}

function TrendFunnels({
  buckets,
  labelOf,
  progressNote,
  t,
}: {
  buckets: TrendBucket[];
  labelOf: (start: string) => string;
  progressNote: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  // Headline = the reliable commitment signal (filled/created). Played/quality
  // depend on post-match feedback, so they stay out of the trend and live only
  // in the cumulative funnel where coverage is shown.
  const points: TrendPoint[] = buckets.map(({ start, totals }) => {
    const c = totals.created;
    return {
      bucket: labelOf(start),
      created: c,
      commitment: c > 0 ? Math.round((totals.filled / c) * 100) : 0,
      filled: totals.filled,
      createdNotFilled: totals.created - totals.filled,
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-medium text-muted-foreground m-0 mb-2">
          {t('matchesTab.weeklyRatesTitle')}
        </p>
        <RateTrendChart
          data={points}
          xKey="bucket"
          volumeKey="created"
          volumeLabel={t('matchesTab.stageCreated')}
          series={[
            { key: 'commitment', label: t('matchesTab.trendCommitment'), color: 'var(--chart-1)' },
          ]}
        />
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted-foreground m-0 mb-2">
          {t('matchesTab.weeklyVolumeTitle')}
        </p>
        <StackedFunnelChart
          data={points}
          xKey="bucket"
          segments={[
            { key: 'filled', label: t('matchesTab.stageFilled'), color: 'var(--chart-1)' },
            {
              key: 'createdNotFilled',
              label: t('matchesTab.segCreatedNotFilled'),
              color: 'var(--muted-foreground)',
              opacity: 0.3,
            },
          ]}
        />
      </div>
      <p className="text-[11px] text-muted-foreground m-0">{progressNote}</p>
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
  playedIncomplete: number;
  ratingSum: number;
  ratingCount: number;
  feedbackExpected: number;
  feedbackPresent: number;
  feedbackCheckedIn: number;
  feedbackRated: number;
  feedbackDone: number;
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
    playedIncomplete: 0,
    ratingSum: 0,
    ratingCount: 0,
    feedbackExpected: 0,
    feedbackPresent: 0,
    feedbackCheckedIn: 0,
    feedbackRated: 0,
    feedbackDone: 0,
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
  t.playedIncomplete += row.playedIncomplete;
  t.ratingSum += row.ratingSum;
  t.ratingCount += row.ratingCount;
  t.feedbackExpected += row.feedbackExpected;
  t.feedbackPresent += row.feedbackPresent;
  t.feedbackCheckedIn += row.feedbackCheckedIn;
  t.feedbackRated += row.feedbackRated;
  t.feedbackDone += row.feedbackDone;
}

function aggregate(data: MatchQualityPoint[]): {
  totals: Totals;
  autoTotals: Totals;
  nonAutoTotals: Totals;
} {
  const totals = emptyTotals();
  const autoTotals = emptyTotals();
  const nonAutoTotals = emptyTotals();

  for (const row of data) {
    addToTotals(totals, row);
    if (row.isAutoGenerated) addToTotals(autoTotals, row);
    else addToTotals(nonAutoTotals, row);
  }

  return { totals, autoTotals, nonAutoTotals };
}
