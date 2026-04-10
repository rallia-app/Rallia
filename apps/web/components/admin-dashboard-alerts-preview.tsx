'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { useAdminAlerts, useAdminStatus } from '@rallia/shared-hooks';
import { Bell, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

const severityStyles: Record<string, string> = {
  critical:
    'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',
  warning:
    'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
  info: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900',
};

export function AdminDashboardAlertsPreview() {
  const t = useTranslations('admin.dashboard.alertsPreview');
  const tAlerts = useTranslations('admin.alerts');
  const { adminId, loading: statusLoading } = useAdminStatus();

  const { alerts, isLoading } = useAdminAlerts({
    adminId: adminId ?? '',
    autoFetch: !!adminId,
    limit: 5,
    pollingInterval: 60000,
  });

  const loading = statusLoading || isLoading;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="size-4 text-muted-foreground" />
          {t('title')}
        </CardTitle>
        <Link
          href="/admin/alerts"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          {t('viewAll')}
          <ChevronRight className="size-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground m-0 py-4 text-center">{t('noAlerts')}</p>
        ) : (
          <div className="space-y-2">
            {alerts.map(alert => (
              <div key={alert.id} className="flex items-start gap-3 rounded-md border p-3">
                <Badge
                  className={`text-[10px] px-1.5 py-0 shrink-0 ${severityStyles[alert.severity] ?? ''}`}
                >
                  {tAlerts(alert.severity as 'critical' | 'warning' | 'info')}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium m-0 truncate">{alert.title}</p>
                  {alert.message && (
                    <p className="text-xs text-muted-foreground m-0 truncate mt-0.5">
                      {alert.message}
                    </p>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(alert.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
