'use client';

import {
  useInvitationStats,
  useInvitationTargetNames,
  useInvitationTimeseries,
  useInvitationTopTargets,
  useMatchStats,
  useSportStats,
  useUserStats,
  type InvitationType,
} from '@rallia/shared-hooks';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { AdminInvitationSparkline } from '@/components/admin-invitation-sparkline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const INVITATION_DAYS_OPTIONS = [7, 30, 90] as const;
type DaysWindow = (typeof INVITATION_DAYS_OPTIONS)[number];

export function AdminAnalyticsOverview() {
  const t = useTranslations('admin.analytics');
  const { stats: userStats, loading: usersLoading } = useUserStats();
  const { stats: matchStats, loading: matchesLoading } = useMatchStats();
  const { stats: sportStats, loading: sportsLoading } = useSportStats();

  const [days, setDays] = useState<DaysWindow>(30);
  const { stats: invitationStats, loading: invitationsLoading } = useInvitationStats(days);
  const { data: timeseries } = useInvitationTimeseries(days);
  const [selectedType, setSelectedType] = useState<InvitationType | null>(null);
  const { targets: topTargets, loading: targetsLoading } = useInvitationTopTargets(
    selectedType,
    days
  );
  const targetIds = useMemo(() => topTargets.map(target => target.targetId), [topTargets]);
  const { names: targetNames } = useInvitationTargetNames(selectedType, targetIds);

  const posthogUrl = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.posthog.com';

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

  return (
    <div className="flex flex-col gap-6">
      {/* Quick stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* User stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('players')}</CardTitle>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : userStats ? (
              <div className="grid grid-cols-2 gap-4">
                <StatItem label={t('totalUsers')} value={userStats.totalUsers} />
                <StatItem label={t('activeToday')} value={userStats.activeToday} />
                <StatItem label={t('activeWeek')} value={userStats.activeWeek} />
                <StatItem label={t('newWeek')} value={userStats.newWeek} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground m-0">{t('noData')}</p>
            )}
          </CardContent>
        </Card>

        {/* Match stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('matchStatistics')}</CardTitle>
          </CardHeader>
          <CardContent>
            {matchesLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : matchStats ? (
              <div className="grid grid-cols-2 gap-4">
                <StatItem label={t('matches')} value={matchStats.totalMatches} />
                <StatItem label={t('scheduled')} value={matchStats.scheduledMatches} />
                <StatItem label={t('completed')} value={matchStats.completedMatches} />
                <StatItem label={t('cancelled')} value={matchStats.cancelledMatches} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground m-0">{t('noData')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invitations & Referrals */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t('invitations')}</CardTitle>
              <p className="text-xs text-muted-foreground m-0 mt-1">
                {t('invitationsDescription', { days })}
              </p>
            </div>
            <Select
              value={String(days)}
              onValueChange={value => setDays(Number(value) as DaysWindow)}
            >
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITATION_DAYS_OPTIONS.map(option => (
                  <SelectItem key={option} value={String(option)}>
                    {t(`timeRange.${option}d`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {invitationsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : invitationStats.length === 0 ? (
            <p className="text-sm text-muted-foreground m-0">{t('noClicksYet')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatItem label={t('totalClicks')} value={invitationTotals.clicks} />
                <StatItem label={t('uniqueDevices')} value={invitationTotals.uniqueDevices} />
                <StatItem label={t('matchedInstalls')} value={invitationTotals.matchedInstalls} />
                <StatItem
                  label={t('attributedSignups')}
                  value={invitationTotals.attributedSignups}
                />
              </div>

              {/* Per-type breakdown */}
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('clickType')}</TableHead>
                      <TableHead className="w-[140px]">{t('trend')}</TableHead>
                      <TableHead className="text-right">{t('totalClicks')}</TableHead>
                      <TableHead className="text-right">{t('uniqueDevices')}</TableHead>
                      <TableHead className="text-right">{t('matchedInstalls')}</TableHead>
                      <TableHead className="text-right">{t('attributedSignups')}</TableHead>
                      <TableHead className="text-right">{t('conversionRate')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitationStats.map((row, idx) => {
                      const isSelected = selectedType === row.invitationType;
                      const points = timeseries[row.invitationType] ?? [];
                      const colorIndex = ((idx % 5) + 1) as 1 | 2 | 3 | 4 | 5;
                      return (
                        <TableRow
                          key={row.invitationType}
                          className={`cursor-pointer ${isSelected ? 'bg-muted/50' : ''}`}
                          onClick={() => setSelectedType(isSelected ? null : row.invitationType)}
                        >
                          <TableCell className="font-medium">
                            {t(`invitationType.${row.invitationType}`)}
                          </TableCell>
                          <TableCell className="w-[140px] py-1">
                            <AdminInvitationSparkline points={points} colorIndex={colorIndex} />
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

              {/* Drill-down: funnel + top targets for selected type */}
              {selectedType && (
                <div className="rounded-md border">
                  <div className="px-4 py-2 text-xs font-medium text-muted-foreground border-b">
                    {t('topTargets', { type: t(`invitationType.${selectedType}`) })}
                  </div>
                  {selectedRow && (
                    <div className="px-4 py-3 border-b">
                      <FunnelStrip
                        clicks={selectedRow.clicks}
                        uniqueDevices={selectedRow.uniqueDevices}
                        matchedInstalls={selectedRow.matchedInstalls}
                        attributedSignups={selectedRow.attributedSignups}
                        labels={{
                          clicks: t('totalClicks'),
                          uniqueDevices: t('uniqueDevices'),
                          matchedInstalls: t('matchedInstalls'),
                          attributedSignups: t('attributedSignups'),
                        }}
                      />
                    </div>
                  )}
                  {targetsLoading ? (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-6 w-full" />
                      ))}
                    </div>
                  ) : topTargets.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground m-0">
                      {t('noClicksYet')}
                    </p>
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
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sport breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('sportStatistics')}</CardTitle>
        </CardHeader>
        <CardContent>
          {sportsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sportStats.length === 0 ? (
            <p className="text-sm text-muted-foreground m-0">{t('noData')}</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sport</TableHead>
                    <TableHead className="text-right">{t('players')}</TableHead>
                    <TableHead className="text-right">{t('matches')}</TableHead>
                    <TableHead className="text-right">{t('completed')}</TableHead>
                    <TableHead className="text-right">{t('activeWeek')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sportStats.map(sport => (
                    <TableRow key={sport.sportId}>
                      <TableCell className="font-medium">{sport.sportName}</TableCell>
                      <TableCell className="text-right">{sport.totalPlayers}</TableCell>
                      <TableCell className="text-right">{sport.matchesCreated}</TableCell>
                      <TableCell className="text-right">{sport.matchesCompleted}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-xs">
                          {sport.activePlayersWeek}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* PostHog link */}
      <div className="flex justify-center">
        <Button variant="outline" asChild>
          <a href={posthogUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4 mr-2" />
            {t('viewInPostHog')}
          </a>
        </Button>
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-bold m-0">{value}</p>
      <p className="text-xs text-muted-foreground m-0 mt-0.5">{label}</p>
    </div>
  );
}

type FunnelStripProps = {
  clicks: number;
  uniqueDevices: number;
  matchedInstalls: number;
  attributedSignups: number;
  labels: {
    clicks: string;
    uniqueDevices: string;
    matchedInstalls: string;
    attributedSignups: string;
  };
};

/**
 * Compact horizontal funnel: 4 stages where each bar's width is value/clicks.
 * The drop-off vs. the previous stage is rendered as a small percentage label.
 */
function FunnelStrip({
  clicks,
  uniqueDevices,
  matchedInstalls,
  attributedSignups,
  labels,
}: FunnelStripProps) {
  const stages = [
    { label: labels.clicks, value: clicks, tone: 'bg-primary/80' },
    { label: labels.uniqueDevices, value: uniqueDevices, tone: 'bg-primary/65' },
    { label: labels.matchedInstalls, value: matchedInstalls, tone: 'bg-primary/45' },
    { label: labels.attributedSignups, value: attributedSignups, tone: 'bg-primary/30' },
  ];
  const denom = clicks > 0 ? clicks : 1;

  return (
    <div className="flex flex-col gap-1.5">
      {stages.map((stage, i) => {
        const widthPct = Math.max(2, Math.round((stage.value / denom) * 100));
        const prev = i > 0 ? stages[i - 1].value : null;
        const dropoff =
          prev && prev > 0 && stage.value < prev
            ? Math.round(((prev - stage.value) / prev) * 100)
            : null;
        return (
          <div key={stage.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">{stage.label}</span>
            <div className="relative flex-1 h-5 bg-muted rounded-sm overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${stage.tone}`}
                style={{ width: `${widthPct}%` }}
              />
              <span className="relative z-10 px-2 text-xs font-medium leading-5">
                {stage.value}
              </span>
            </div>
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
              {dropoff !== null ? `−${dropoff}%` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
