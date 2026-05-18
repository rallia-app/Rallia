'use client';

import {
  useInvitationStats,
  useInvitationTargetNames,
  useInvitationTimeseries,
  useInvitationTopTargets,
  type InvitationStat,
  type InvitationTimeseries,
  type InvitationType,
} from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { FunnelStrip } from '@/components/admin/funnel-strip';
import { KpiCard } from '@/components/admin/kpi-card';
import {
  MultiSeriesAreaChart,
  type ChartPoint,
  type ChartSeries,
} from '@/components/admin/multi-series-area-chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Invitations & Referrals analytics. Visually mirrors the UTM section:
 * KPI strip on top, headline multi-series chart of clicks/day per invitation
 * type, sortable table of types, drilldown funnel + top targets when a row
 * is selected.
 */
export function InvitationsReferralsSection({ days }: { days: number }) {
  const t = useTranslations('admin.analytics');
  const { stats: invitationStats, loading: invitationsLoading } = useInvitationStats(days);
  const { data: timeseries } = useInvitationTimeseries(days);
  const [selectedType, setSelectedType] = useState<InvitationType | null>(null);
  const { targets: topTargets, loading: targetsLoading } = useInvitationTopTargets(
    selectedType,
    days
  );
  const targetIds = useMemo(() => topTargets.map(target => target.targetId), [topTargets]);
  const { names: targetNames } = useInvitationTargetNames(selectedType, targetIds);

  const invitationTotals = invitationStats.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      uniqueDevices: acc.uniqueDevices + row.uniqueDevices,
      matchedInstalls: acc.matchedInstalls + row.matchedInstalls,
      attributedSignups: acc.attributedSignups + row.attributedSignups,
    }),
    { clicks: 0, uniqueDevices: 0, matchedInstalls: 0, attributedSignups: 0 }
  );

  const selectedRow = invitationStats.find(row => row.invitationType === selectedType) ?? null;
  const isEmpty = !invitationsLoading && invitationStats.length === 0;

  const { chartData, chartSeries } = useInvitationChart(invitationStats, timeseries, t);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('invitations')}</CardTitle>
        <p className="text-xs text-muted-foreground m-0 mt-1">
          {t('invitationsDescription', { days })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* KPI strip — same shape & visual rhythm as UTM */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label={t('totalClicks')}
            value={invitationsLoading ? null : invitationTotals.clicks}
            loading={invitationsLoading}
          />
          <KpiCard
            label={t('uniqueDevices')}
            value={invitationsLoading ? null : invitationTotals.uniqueDevices}
            loading={invitationsLoading}
          />
          <KpiCard
            label={t('matchedInstalls')}
            value={invitationsLoading ? null : invitationTotals.matchedInstalls}
            loading={invitationsLoading}
          />
          <KpiCard
            label={t('attributedSignups')}
            value={invitationsLoading ? null : invitationTotals.attributedSignups}
            loading={invitationsLoading}
          />
        </div>

        {/* Headline chart — clicks/day per invitation type */}
        <div className="rounded-md border p-4">
          <div className="mb-3">
            <p className="text-sm font-medium m-0">{t('invitationsTrendTitle')}</p>
            <p className="text-xs text-muted-foreground m-0 mt-0.5">{t('invitationsTrendHint')}</p>
          </div>
          {invitationsLoading ? (
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
              <p className="text-sm text-muted-foreground m-0">{t('noClicksYet')}</p>
            </div>
          )}
        </div>

        {/* Per-type table */}
        {invitationsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <p className="text-sm text-muted-foreground m-0">{t('noClicksYet')}</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('clickType')}</TableHead>
                  <TableHead className="text-right">{t('totalClicks')}</TableHead>
                  <TableHead className="text-right">{t('uniqueDevices')}</TableHead>
                  <TableHead className="text-right">{t('matchedInstalls')}</TableHead>
                  <TableHead className="text-right">{t('attributedSignups')}</TableHead>
                  <TableHead className="text-right">{t('conversionRate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitationStats.map(row => {
                  const isSelected = selectedType === row.invitationType;
                  return (
                    <TableRow
                      key={row.invitationType}
                      className={`cursor-pointer ${isSelected ? 'bg-muted/50' : ''}`}
                      onClick={() => setSelectedType(isSelected ? null : row.invitationType)}
                    >
                      <TableCell className="font-medium">
                        {t(`invitationType.${row.invitationType}`)}
                      </TableCell>
                      <TableCell className="text-right">{row.clicks}</TableCell>
                      <TableCell className="text-right">{row.uniqueDevices}</TableCell>
                      <TableCell className="text-right">{row.matchedInstalls}</TableCell>
                      <TableCell className="text-right">{row.attributedSignups}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-xs">
                          {(row.conversionRate * 100).toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Drilldown — funnel + top targets, same pattern as UTM section */}
        {selectedType && selectedRow && (
          <div className="rounded-md border p-4">
            <p className="text-xs font-medium text-muted-foreground m-0 mb-3">
              {t('topTargets', { type: t(`invitationType.${selectedType}`) })}
            </p>
            <FunnelStrip
              stages={[
                { label: t('totalClicks'), value: selectedRow.clicks },
                { label: t('uniqueDevices'), value: selectedRow.uniqueDevices },
                { label: t('matchedInstalls'), value: selectedRow.matchedInstalls },
                { label: t('attributedSignups'), value: selectedRow.attributedSignups },
              ]}
            />
            <div className="mt-4 rounded-md border">
              {targetsLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : topTargets.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground m-0">{t('noClicksYet')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('targetId')}</TableHead>
                      <TableHead className="text-right">{t('totalClicks')}</TableHead>
                      <TableHead className="text-right">{t('uniqueDevices')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topTargets.map(target => {
                      const friendly = targetNames.get(target.targetId);
                      const isResolved = friendly && friendly !== target.targetId;
                      return (
                        <TableRow key={target.targetId}>
                          <TableCell>
                            {isResolved ? (
                              <span title={target.targetId}>{friendly}</span>
                            ) : (
                              <span className="font-mono text-xs">{target.targetId}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{target.clicks}</TableCell>
                          <TableCell className="text-right">{target.uniqueDevices}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Pivot the per-type timeseries into the (day-keyed point + per-series legend)
 * shape MultiSeriesAreaChart expects. Series are ordered by total volume and
 * coloured deterministically so the same invitation type keeps the same
 * colour across renders.
 */
function useInvitationChart(
  stats: InvitationStat[],
  timeseries: InvitationTimeseries,
  t: (key: string) => string
): { chartData: ChartPoint[]; chartSeries: ChartSeries[] } {
  return useMemo(() => {
    if (stats.length === 0) return { chartData: [], chartSeries: [] };

    // Series order = volume desc; gives the most-trafficked types the
    // strongest colour (chart-1) for visual prominence.
    const ordered = [...stats].filter(s => s.clicks > 0).sort((a, b) => b.clicks - a.clicks);

    const chartSeries: ChartSeries[] = ordered.map((s, i) => ({
      name: s.invitationType,
      label: t(`invitationType.${s.invitationType}`),
      colorIndex: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    }));

    const byDay = new Map<string, ChartPoint>();
    for (const series of chartSeries) {
      const points = timeseries[series.name as InvitationType] ?? [];
      for (const p of points) {
        const point = byDay.get(p.date) ?? ({ day: p.date } as ChartPoint);
        point[series.name] = p.clicks;
        byDay.set(p.date, point);
      }
    }
    const chartData = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
    return { chartData, chartSeries };
  }, [stats, timeseries, t]);
}

function formatDayLabel(day: string): string {
  try {
    const d = new Date(day);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return day;
  }
}
