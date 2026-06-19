'use client';

import { useAutoInviteFunnel, type AutoInviteFunnelPoint } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { daysCoveringLastNWeeks, lastNWeekStarts, shortWeekLabel } from './week-utils';
import { RateTrendChart, StackedFunnelChart, type TrendPoint } from './weekly-trend-charts';

import { InsightCardHeader, SegmentedToggle } from '@/components/admin/insight-card';
import { KpiCard } from '@/components/admin/kpi-card';
import { WindowSelect } from '@/components/admin/window-select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const DAY_OPTIONS = [7, 14, 30] as const;
type DaysWindow = (typeof DAY_OPTIONS)[number];

type FunnelView = 'cumulative' | 'weekly';

// Match source the funnel is scoped to. Maps to the RPC's p_is_auto:
// all -> null, auto -> true, organic -> false.
type Source = 'all' | 'auto' | 'organic';
const SOURCE_TITLE: Record<Source, string> = {
  all: 'autoInvite.titleAll',
  auto: 'autoInvite.title',
  organic: 'autoInvite.titleOrganic',
};
const SOURCE_HINT: Record<Source, string> = {
  all: 'autoInvite.hintAll',
  auto: 'autoInvite.hint',
  organic: 'autoInvite.hintOrganic',
};

const WEEKS_SHOWN = 6;

interface AutoInviteTotals {
  matchesCreated: number;
  invitesSent: number;
  invitesSettled: number;
  invitesInFlight: number;
  responded: number;
  accepted: number;
  declined: number;
  timeSuggested: number;
  noResponse: number;
  requestsTotal: number;
  requestsApproved: number;
  requestsRefused: number;
  requestsPending: number;
  declineReasons: Record<string, number>;
  noResponseExpired: number;
  /** Responded-count-weighted median across sports (approximation). */
  medianResponseHours: number | null;
}

function aggregate(rows: AutoInviteFunnelPoint[]): AutoInviteTotals {
  let medianWeighted = 0;
  let medianWeight = 0;
  const totals = rows.reduce<AutoInviteTotals>(
    (acc, r) => {
      acc.matchesCreated += r.matchesCreated;
      acc.invitesSent += r.invitesSent;
      acc.invitesSettled += r.invitesSettled;
      acc.invitesInFlight += r.invitesInFlight;
      acc.responded += r.responded;
      acc.accepted += r.accepted;
      acc.declined += r.declined;
      acc.timeSuggested += r.timeSuggested;
      acc.noResponse += r.noResponse;
      acc.requestsTotal += r.requestsTotal;
      acc.requestsApproved += r.requestsApproved;
      acc.requestsRefused += r.requestsRefused;
      acc.requestsPending += r.requestsPending;
      acc.noResponseExpired += r.noResponseExpired;
      for (const [reason, n] of Object.entries(r.declineReasons)) {
        acc.declineReasons[reason] = (acc.declineReasons[reason] ?? 0) + n;
      }
      if (r.medianResponseHours != null && r.responded > 0) {
        medianWeighted += r.medianResponseHours * r.responded;
        medianWeight += r.responded;
      }
      return acc;
    },
    {
      matchesCreated: 0,
      invitesSent: 0,
      invitesSettled: 0,
      invitesInFlight: 0,
      responded: 0,
      accepted: 0,
      declined: 0,
      timeSuggested: 0,
      noResponse: 0,
      requestsTotal: 0,
      requestsApproved: 0,
      requestsRefused: 0,
      requestsPending: 0,
      declineReasons: {},
      noResponseExpired: 0,
      medianResponseHours: null,
    }
  );
  totals.medianResponseHours = medianWeight > 0 ? medianWeighted / medianWeight : null;
  return totals;
}

const KNOWN_DECLINE_REASONS = [
  'bad_timing',
  'too_far',
  'skill_mismatch',
  'dont_know_player',
  'cost',
  'changed_mind',
  'other',
] as const;

export function AutoInviteFunnel() {
  const t = useTranslations('admin.analytics');
  const tReasons = useTranslations('matchActions.declineReasons');
  const [days, setDays] = useState<DaysWindow>(14);
  const [source, setSource] = useState<Source>('all');
  const [view, setView] = useState<FunnelView>('weekly');
  // Weekly view always covers the last 6 ISO weeks, independent of the window.
  const { data, loading } = useAutoInviteFunnel(
    view === 'weekly' ? daysCoveringLastNWeeks(WEEKS_SHOWN) : days,
    48,
    source === 'all' ? null : source === 'auto',
    view === 'weekly' ? 'week' : 'total'
  );
  const totals = useMemo(() => aggregate(data), [data]);
  const weekly = useMemo(() => {
    // Exactly the last WEEKS_SHOWN tiles, zero-filled; rows outside are dropped.
    const map = new Map<string, AutoInviteFunnelPoint[]>(
      lastNWeekStarts(WEEKS_SHOWN).map(week => [week, [] as AutoInviteFunnelPoint[]])
    );
    for (const row of data) {
      if (!row.bucketStart) continue;
      map.get(row.bucketStart)?.push(row);
    }
    return Array.from(map.entries()).map(([weekStart, rows]) => ({
      weekStart,
      totals: aggregate(rows),
    }));
  }, [data]);

  const reasonRows = useMemo(() => {
    const entries = Object.entries(totals.declineReasons).sort((a, b) => b[1] - a[1]);
    const base = entries.reduce((sum, [, n]) => sum + n, 0);
    return { entries, base };
  }, [totals.declineReasons]);

  const reasonLabel = (reason: string): string => {
    if (reason === 'unspecified') return t('autoInvite.reasonUnspecified');
    return (KNOWN_DECLINE_REASONS as readonly string[]).includes(reason)
      ? tReasons(reason as (typeof KNOWN_DECLINE_REASONS)[number])
      : reason;
  };

  const responseRate =
    totals.invitesSettled > 0 ? (totals.responded / totals.invitesSettled) * 100 : null;
  const avgPerMatch = totals.matchesCreated > 0 ? totals.invitesSent / totals.matchesCreated : null;

  return (
    <Card>
      <InsightCardHeader
        title={t(SOURCE_TITLE[source])}
        hint={view === 'weekly' ? t('autoInvite.weeklyHint') : t(SOURCE_HINT[source])}
        controls={
          <>
            <SegmentedToggle
              value={source}
              onChange={v => setSource(v as Source)}
              options={[
                { value: 'all', label: t('matchesTab.segmentAll') },
                { value: 'auto', label: t('matchesTab.sourceAuto') },
                { value: 'organic', label: t('matchesTab.sourceOrganic') },
              ]}
            />
            <SegmentedToggle
              value={view}
              onChange={v => setView(v as FunnelView)}
              options={[
                { value: 'weekly', label: t('matchesTab.viewWeekly') },
                { value: 'cumulative', label: t('matchesTab.viewCumulative') },
              ]}
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
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : totals.matchesCreated === 0 && totals.invitesSent === 0 ? (
          <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Fan-out head: matches -> invitations (a fan-out, not a drop-off) */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KpiCard
                label={t('autoInvite.matchesCreated')}
                value={totals.matchesCreated}
                hint={t(
                  source === 'auto'
                    ? 'autoInvite.matchesCreatedHint'
                    : 'autoInvite.matchesCreatedHintHuman'
                )}
              />
              <KpiCard
                label={t('autoInvite.invitesSent')}
                value={totals.invitesSent}
                hint={
                  avgPerMatch != null
                    ? t('autoInvite.invitesSentHint', { avg: avgPerMatch.toFixed(1) })
                    : undefined
                }
              />
              <KpiCard
                label={t('autoInvite.responseRate')}
                value={responseRate != null ? `${responseRate.toFixed(0)}%` : '—'}
                hint={t('autoInvite.responseRateHint', {
                  responded: totals.responded,
                  settled: totals.invitesSettled,
                })}
              />
            </div>

            {totals.invitesInFlight > 0 && (
              <p className="text-[11px] text-muted-foreground m-0">
                {t('autoInvite.settleNote', { inFlight: totals.invitesInFlight })}
              </p>
            )}

            {view === 'weekly' ? (
              <WeeklyInviteFunnels weeks={weekly} t={t} />
            ) : (
              <>
                {/* Response funnel over the settled cohort */}
                {totals.invitesSettled === 0 ? (
                  <p className="text-sm text-muted-foreground m-0">{t('autoInvite.allInFlight')}</p>
                ) : (
                  <div className="space-y-3">
                    <Bar
                      label={t('autoInvite.stageEligible')}
                      description={t('autoInvite.stageEligibleDesc')}
                      count={totals.invitesSettled}
                      base={totals.invitesSettled}
                      tone="primary"
                    />
                    <Bar
                      label={t('autoInvite.stageResponded')}
                      count={totals.responded}
                      base={totals.invitesSettled}
                      tone="primary"
                    />
                    {/* Category split (precedence oui > non > nouvel horaire), base = responses */}
                    <div className="space-y-2 pl-3 border-l">
                      <Bar
                        label={t('autoInvite.catOui')}
                        count={totals.accepted}
                        base={totals.responded}
                        tone="emerald"
                        small
                      />
                      <Bar
                        label={t('autoInvite.catNon')}
                        count={totals.declined}
                        base={totals.responded}
                        tone="rose"
                        small
                      />
                      <Bar
                        label={t('autoInvite.catNouvelHoraire')}
                        count={totals.timeSuggested}
                        base={totals.responded}
                        tone="amber"
                        small
                      />
                    </div>
                    <Bar
                      label={t('autoInvite.noResponse')}
                      count={totals.noResponse}
                      base={totals.invitesSettled}
                      tone="muted"
                    />
                  </div>
                )}

                {/* Why invites die — decline reasons, response latency, lapsed-unanswered */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t('autoInvite.whyTitle')}
                  </span>
                  <p className="text-[11px] text-muted-foreground m-0">{t('autoInvite.whyHint')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <KpiCard
                      label={t('autoInvite.medianResponse')}
                      value={
                        totals.medianResponseHours != null
                          ? `${totals.medianResponseHours.toFixed(1)}h`
                          : '—'
                      }
                    />
                    <KpiCard
                      label={t('autoInvite.lapsedExpired')}
                      value={totals.noResponseExpired}
                    />
                  </div>
                  {reasonRows.base > 0 && (
                    <div className="space-y-2 mt-1">
                      {reasonRows.entries.map(([reason, n]) => (
                        <Bar
                          key={reason}
                          label={reasonLabel(reason)}
                          count={n}
                          base={reasonRows.base}
                          tone={reason === 'unspecified' ? 'muted' : 'rose'}
                          small
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Self-request approval flow — a separate population from invited candidates */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t('autoInvite.requestsTitle')}
                  </span>
                  <p className="text-[11px] text-muted-foreground m-0">
                    {t('autoInvite.requestsHint')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[11px] font-normal">
                      {t('autoInvite.requestsApproved')}: {totals.requestsApproved.toLocaleString()}
                    </Badge>
                    <Badge variant="outline" className="text-[11px] font-normal">
                      {t('autoInvite.requestsRefused')}: {totals.requestsRefused.toLocaleString()}
                    </Badge>
                    <Badge variant="outline" className="text-[11px] font-normal">
                      {t('autoInvite.requestsPending')}: {totals.requestsPending.toLocaleString()}
                    </Badge>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const TONE_CLASS: Record<string, string> = {
  primary: 'bg-primary',
  emerald: 'bg-emerald-500/70',
  rose: 'bg-rose-500/70',
  amber: 'bg-amber-500/70',
  muted: 'bg-muted-foreground/40',
};

function WeeklyInviteFunnels({
  weeks,
  t,
}: {
  weeks: { weekStart: string; totals: AutoInviteTotals }[];
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (weeks.length === 0) {
    return <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>;
  }
  const points: TrendPoint[] = weeks.map(({ weekStart, totals }) => {
    const s = totals.invitesSettled;
    return {
      week: shortWeekLabel(weekStart),
      settled: s,
      response: s > 0 ? Math.round((totals.responded / s) * 100) : 0,
      accept: s > 0 ? Math.round((totals.accepted / s) * 100) : 0,
      accepted: totals.accepted,
      declined: totals.declined,
      timeSuggested: totals.timeSuggested,
      noResponse: totals.noResponse,
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
          volumeKey="settled"
          volumeLabel={t('autoInvite.stageEligible')}
          series={[
            { key: 'response', label: t('autoInvite.stageResponded'), color: '#2563eb' },
            { key: 'accept', label: t('autoInvite.catOui'), color: '#10b981', dash: '5 3' },
          ]}
        />
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted-foreground m-0 mb-2">
          {t('matchesTab.weeklyVolumeTitle')}
        </p>
        <StackedFunnelChart
          data={points}
          segments={[
            { key: 'accepted', label: t('autoInvite.catOui'), color: '#10b981' },
            { key: 'declined', label: t('autoInvite.catNon'), color: '#f43f5e' },
            { key: 'timeSuggested', label: t('autoInvite.catNouvelHoraire'), color: '#f59e0b' },
            {
              key: 'noResponse',
              label: t('autoInvite.noResponse'),
              color: 'var(--muted-foreground)',
              opacity: 0.3,
            },
          ]}
        />
      </div>
      <p className="text-[11px] text-muted-foreground m-0">{t('matchesTab.weeklyInProgress')}</p>
    </div>
  );
}

function Bar({
  label,
  description,
  count,
  base,
  tone,
  small,
}: {
  label: string;
  description?: string;
  count: number;
  base: number;
  tone: keyof typeof TONE_CLASS;
  small?: boolean;
}) {
  const pct = base > 0 ? (count / base) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs mb-0.5">
        <span className={small ? '' : 'font-medium'}>{label}</span>
        <span className="text-muted-foreground tabular-nums whitespace-nowrap">
          {count.toLocaleString()} · {pct.toFixed(0)}%
        </span>
      </div>
      {description && <p className="text-[11px] text-muted-foreground m-0 mb-1">{description}</p>}
      <div className={`${small ? 'h-2' : 'h-2.5'} rounded bg-muted overflow-hidden`}>
        <div
          className={`h-full ${TONE_CLASS[tone]}`}
          style={{ width: `${Math.max(pct, count > 0 ? 1.5 : 0)}%` }}
        />
      </div>
    </div>
  );
}
