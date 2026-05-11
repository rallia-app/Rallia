'use client';

import { useMatchStats } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function MatchStatsSection() {
  const t = useTranslations('admin.analytics');
  const { stats, loading } = useMatchStats();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('matchStatistics')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-4">
            <Stat label={t('matches')} value={stats.totalMatches} />
            <Stat label={t('scheduled')} value={stats.scheduledMatches} />
            <Stat label={t('completed')} value={stats.completedMatches} />
            <Stat label={t('cancelled')} value={stats.cancelledMatches} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground m-0">{t('noData')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-bold m-0">{value}</p>
      <p className="text-xs text-muted-foreground m-0 mt-0.5">{label}</p>
    </div>
  );
}
