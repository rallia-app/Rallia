'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  useReports,
  type ReportFilters,
  type ReportPriority,
  type ReportStatus,
  type ReportType,
} from '@rallia/shared-hooks';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { ReportReviewDialog } from './report-review-dialog';

const REPORT_STATUSES: ReportStatus[] = [
  'pending',
  'under_review',
  'dismissed',
  'action_taken',
  'escalated',
];
const REPORT_TYPES: ReportType[] = [
  'harassment',
  'cheating',
  'inappropriate_content',
  'spam',
  'impersonation',
  'no_show',
  'unsportsmanlike',
  'other',
];
const REPORT_PRIORITIES: ReportPriority[] = ['urgent', 'high', 'normal', 'low'];

const priorityColors: Record<ReportPriority, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
  normal: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-950 dark:text-gray-400',
};

const statusColors: Record<ReportStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
  under_review: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  dismissed: 'bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-400',
  action_taken: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  escalated: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

export function ReportsDataTable() {
  const t = useTranslations('admin.moderation');
  const [filters, setFiltersState] = useState<ReportFilters>({});
  const [reviewReportId, setReviewReportId] = useState<string | null>(null);

  const {
    reports,
    counts,
    isLoading,
    hasMore,
    setFilters,
    loadMore,
    dismissReport,
    escalateReport,
    reviewReport,
  } = useReports({ filters });

  const handleFilterChange = useCallback(
    (key: keyof ReportFilters, value: string | undefined) => {
      const newFilters = { ...filters, [key]: value === 'all' ? undefined : value };
      setFiltersState(newFilters);
      setFilters(newFilters);
    },
    [filters, setFilters]
  );

  const handleDismiss = useCallback(
    async (reportId: string) => {
      await dismissReport(reportId);
    },
    [dismissReport]
  );

  const handleEscalate = useCallback(
    async (reportId: string) => {
      await escalateReport(reportId);
    },
    [escalateReport]
  );

  const selectedReport = reviewReportId ? reports.find(r => r.id === reviewReportId) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary badges */}
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="text-xs">
          {t('pending')}: {counts.pending}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {t('underReview')}: {counts.under_review}
        </Badge>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.status ?? 'all'}
          onValueChange={v => handleFilterChange('status', v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t('filterStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filterStatus')}</SelectItem>
            {REPORT_STATUSES.map(s => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.reportType ?? 'all'}
          onValueChange={v => handleFilterChange('reportType', v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('filterType')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filterType')}</SelectItem>
            {REPORT_TYPES.map(rt => (
              <SelectItem key={rt} value={rt}>
                {t(`reportType.${rt}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.priority ?? 'all'}
          onValueChange={v => handleFilterChange('priority', v)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder={t('filterPriority')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filterPriority')}</SelectItem>
            {REPORT_PRIORITIES.map(p => (
              <SelectItem key={p} value={p}>
                {t(`priority.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filters.status || filters.reportType || filters.priority) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFiltersState({});
              setFilters({});
            }}
          >
            {t('clearFilters')}
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading && reports.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground m-0">{t('noReports')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reporter')}</TableHead>
                  <TableHead>{t('reportedPlayer')}</TableHead>
                  <TableHead>{t('filterType')}</TableHead>
                  <TableHead>{t('filterPriority')}</TableHead>
                  <TableHead>{t('filterStatus')}</TableHead>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map(report => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium">{report.reporter_name}</TableCell>
                    <TableCell className="font-medium">{report.reported_player_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {t(`reportType.${report.report_type}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border-0 ${priorityColors[report.priority]}`}>
                        {t(`priority.${report.priority}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border-0 ${statusColors[report.status]}`}>
                        {t(`status.${report.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(report.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setReviewReportId(report.id)}>
                            {t('review')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDismiss(report.id)}>
                            {t('dismiss')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEscalate(report.id)}>
                            {t('escalate')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      {/* Review Dialog */}
      <ReportReviewDialog
        report={selectedReport ?? null}
        open={!!reviewReportId}
        onClose={() => setReviewReportId(null)}
        onReview={reviewReport}
      />
    </div>
  );
}
