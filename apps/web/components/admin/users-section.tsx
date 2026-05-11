'use client';

import { useUserStats } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function UsersSection() {
  const t = useTranslations('admin.analytics');
  const { stats, loading } = useUserStats();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('players')}</CardTitle>
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
            <Stat label={t('totalUsers')} value={stats.totalUsers} />
            <Stat label={t('activeToday')} value={stats.activeToday} />
            <Stat label={t('activeWeek')} value={stats.activeWeek} />
            <Stat label={t('newWeek')} value={stats.newWeek} />
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
