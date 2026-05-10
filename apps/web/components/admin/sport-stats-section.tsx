'use client';

import { useSportStats } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';

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

export function SportStatsSection() {
  const t = useTranslations('admin.analytics');
  const { stats, loading } = useSportStats();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('sportStatistics')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : stats.length === 0 ? (
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
                {stats.map(sport => (
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
  );
}
