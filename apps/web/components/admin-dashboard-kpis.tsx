'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminDashboardStats } from '@rallia/shared-hooks';
import { AlertTriangle, RefreshCw, Swords, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function AdminDashboardKPIs() {
  const t = useTranslations('admin.dashboard.kpi');
  const tOverview = useTranslations('admin.analytics');
  const { stats, loading, error, refetch } = useAdminDashboardStats();

  const kpis = [
    {
      label: t('activeUsers'),
      value: stats.activeUsers,
      icon: Users,
      color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
    },
    {
      label: t('matchesToday'),
      value: stats.matchesToday,
      icon: Swords,
      color: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-950',
    },
    {
      label: t('pendingReports'),
      value: stats.pendingReports,
      icon: AlertTriangle,
      color: 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-950',
    },
  ];

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between py-6">
          <p className="text-destructive text-sm m-0">{error.message}</p>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{tOverview('overview')}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={loading}
          className="text-muted-foreground"
        >
          <RefreshCw className={`size-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {kpis.map(kpi => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="overflow-hidden">
              <CardContent className="flex items-center gap-4 py-5">
                <div className={`p-2.5 rounded-lg ${kpi.color}`}>
                  <Icon className="size-5" />
                </div>
                <div className="flex flex-col">
                  {loading ? (
                    <Skeleton className="h-8 w-16 mb-1" />
                  ) : (
                    <span className="text-2xl font-bold">{kpi.value}</span>
                  )}
                  <span className="text-sm text-muted-foreground">{kpi.label}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
