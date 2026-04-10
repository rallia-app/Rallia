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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuditLog, useAuditStats } from '@rallia/shared-hooks';
import type {
  AuditActionType,
  AuditEntityType,
  AuditLogFilters,
  AuditSeverity,
} from '@rallia/shared-services';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

const ACTION_TYPES: AuditActionType[] = [
  'view',
  'create',
  'update',
  'delete',
  'ban',
  'unban',
  'export',
  'login',
  'logout',
  'search',
  'config_change',
];
const ENTITY_TYPES: AuditEntityType[] = [
  'player',
  'match',
  'report',
  'admin',
  'analytics',
  'settings',
  'system',
];
const SEVERITIES: AuditSeverity[] = ['info', 'warning', 'critical'];

const severityColors: Record<AuditSeverity, string> = {
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

export function AuditLogView() {
  const t = useTranslations('admin.audit');
  const [filters, setFiltersState] = useState<AuditLogFilters>({});
  const { logs, isLoading, hasMore, setFilters, loadMore } = useAuditLog({ filters });
  const { stats, isLoading: statsLoading } = useAuditStats(7);

  const handleFilterChange = useCallback(
    (key: keyof AuditLogFilters, value: string | undefined) => {
      const newFilters: AuditLogFilters = {
        ...filters,
        [key]: value === 'all' ? undefined : value,
      };
      setFiltersState(newFilters);
      setFilters(newFilters);
    },
    [filters, setFilters]
  );

  const clearFilters = useCallback(() => {
    setFiltersState({});
    setFilters({});
  }, [setFilters]);

  const hasActiveFilters = filters.actionType || filters.entityType || filters.severity;

  return (
    <div className="flex flex-col gap-6">
      {/* Stats summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: t('totalActions'), value: stats?.total_actions },
          { label: t('info'), value: stats?.actions_by_severity?.info },
          { label: t('warnings'), value: stats?.actions_by_severity?.warning },
          { label: t('critical'), value: stats?.actions_by_severity?.critical },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground m-0">{stat.label}</p>
              {statsLoading ? (
                <Skeleton className="h-7 w-12 mt-1" />
              ) : (
                <p className="text-2xl font-bold m-0 mt-1">{stat.value ?? 0}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.actionType ?? 'all'}
          onValueChange={v => handleFilterChange('actionType', v)}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder={t('filterByAction')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filterByAction')}</SelectItem>
            {ACTION_TYPES.map(a => (
              <SelectItem key={a} value={a}>
                {a.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={(filters.entityType as string) ?? 'all'}
          onValueChange={v => handleFilterChange('entityType', v)}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder={t('filterByEntity')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filterByEntity')}</SelectItem>
            {ENTITY_TYPES.map(e => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={(filters.severity as string) ?? 'all'}
          onValueChange={v => handleFilterChange('severity', v)}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder={t('filterBySeverity')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filterBySeverity')}</SelectItem>
            {SEVERITIES.map(s => (
              <SelectItem key={s} value={s}>
                {t(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t('clearFilters')}
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading && logs.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground m-0">
              {hasActiveFilters ? t('noLogs') : t('noActivityYet')}
            </p>
            {hasActiveFilters && (
              <Button variant="link" size="sm" onClick={clearFilters} className="mt-2">
                {t('tryDifferentFilters')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('timestamp')}</TableHead>
                  <TableHead>{t('admin')}</TableHead>
                  <TableHead>{t('action')}</TableHead>
                  <TableHead>{t('entity')}</TableHead>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('severity')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {log.admin_name ?? log.admin_email ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {log.action_type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{log.entity_type}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {log.entity_name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border-0 ${severityColors[log.severity]}`}>
                        {t(log.severity)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => loadMore()}>
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
