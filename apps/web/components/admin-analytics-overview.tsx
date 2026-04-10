'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useMatchStats, useSportStats, useUserStats } from '@rallia/shared-hooks';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function AdminAnalyticsOverview() {
  const t = useTranslations('admin.analytics');
  const { stats: userStats, loading: usersLoading } = useUserStats();
  const { stats: matchStats, loading: matchesLoading } = useMatchStats();
  const { stats: sportStats, loading: sportsLoading } = useSportStats();

  const posthogUrl = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.posthog.com';

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
