'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAdminAlerts, useAdminStatus } from '@rallia/shared-hooks';
import { CheckCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

const severityStyles: Record<string, string> = {
  critical:
    'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',
  warning:
    'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
  info: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900',
};

export function AdminAlertsView() {
  const t = useTranslations('admin.alerts');
  const { adminId, loading: statusLoading } = useAdminStatus();
  const [includeRead, setIncludeRead] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  const { alerts, counts, isLoading, markAsRead, markAllAsRead, dismiss } = useAdminAlerts({
    adminId: adminId ?? '',
    autoFetch: !!adminId,
    includeRead,
    limit: 50,
    pollingInterval: 30000,
  });

  const loading = statusLoading || isLoading;

  const filteredAlerts =
    severityFilter === 'all' ? alerts : alerts.filter(a => a.severity === severityFilter);

  return (
    <div className="flex flex-col gap-6">
      {/* Summary + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            {t('unread')}: {counts.total}
          </Badge>
          {counts.critical > 0 && (
            <Badge className={`text-xs border ${severityStyles.critical}`}>
              {t('critical')}: {counts.critical}
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAllAsRead()}
          disabled={counts.total === 0}
        >
          <CheckCheck className="size-4 mr-1.5" />
          {t('markAllReadTitle')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allSeverities')}</SelectItem>
            <SelectItem value="critical">{t('critical')}</SelectItem>
            <SelectItem value="warning">{t('warning')}</SelectItem>
            <SelectItem value="info">{t('info')}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Switch id="show-read" checked={includeRead} onCheckedChange={setIncludeRead} />
          <Label htmlFor="show-read" className="text-sm text-muted-foreground cursor-pointer">
            {t('showRead')}
          </Label>
        </div>
      </div>

      {/* Alert list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filteredAlerts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-lg font-medium m-0">{t('noAlerts')}</p>
            <p className="text-sm text-muted-foreground m-0 mt-1">{t('allClear')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredAlerts.map(alert => (
            <Card
              key={alert.id}
              className={`transition-colors ${alert.is_read ? 'opacity-60' : ''}`}
            >
              <CardContent className="flex items-start gap-4 py-4">
                <Badge
                  className={`text-[10px] px-1.5 py-0 shrink-0 mt-0.5 ${severityStyles[alert.severity] ?? ''}`}
                >
                  {t(alert.severity as 'critical' | 'warning' | 'info')}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium m-0">{alert.title}</p>
                  {alert.message && (
                    <p className="text-xs text-muted-foreground m-0 mt-1">{alert.message}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground m-0 mt-2">
                    {new Date(alert.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!alert.is_read && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => markAsRead(alert.id)}
                      title="Mark as read"
                    >
                      <CheckCheck className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => dismiss(alert.id)}
                    title="Dismiss"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
