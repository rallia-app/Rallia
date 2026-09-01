'use client';

import { Bug, EyeOff, ThumbsUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { AdminBugReportDialog } from '@/components/admin-bug-report-dialog';
import {
  DataTable,
  DataTableFilters,
  type ColumnDef,
  type FilterDef,
} from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import {
  bugSeverity,
  bugSummary,
  BUG_SEVERITIES,
  BUG_STATUSES,
  FEEDBACK_MODULES,
  SEVERITY_BADGE,
  STATUS_BADGE,
  type AdminBugReport,
} from '@/lib/bug-reports';

interface AdminBugReportsTableProps {
  reports: AdminBugReport[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  canTriage: boolean;
}

export function AdminBugReportsTable(props: AdminBugReportsTableProps) {
  const t = useTranslations('admin.bugReports');
  const locale = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));

  const columns: ColumnDef<AdminBugReport>[] = [
    {
      key: 'summary',
      header: t('table.report'),
      render: item => (
        <div className="flex items-start gap-2 max-w-md">
          {item.hidden_at && (
            <EyeOff className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium line-clamp-2">{bugSummary(item) || t('noDetails')}</span>
        </div>
      ),
    },
    {
      key: 'severity',
      header: t('table.severity'),
      render: item => {
        const severity = bugSeverity(item);
        if (!severity) return <span className="text-muted-foreground">-</span>;
        return (
          <Badge variant="outline" className={`text-xs border-0 ${SEVERITY_BADGE[severity]}`}>
            {t(`severity.${severity}`)}
          </Badge>
        );
      },
    },
    {
      key: 'module',
      header: t('table.module'),
      render: item => (
        <Badge variant="outline" className="text-xs">
          {t(`module.${item.module}`)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('table.status'),
      sortable: true,
      render: item => (
        <Badge
          variant="outline"
          className={`text-xs border-0 ${STATUS_BADGE[item.status] ?? STATUS_BADGE.closed}`}
        >
          {t(`status.${item.status}`)}
        </Badge>
      ),
    },
    {
      key: 'reporter',
      header: t('table.reporter'),
      render: item => (
        <span className="text-muted-foreground">{item.reporter?.name ?? t('anonymous')}</span>
      ),
    },
    {
      key: 'app_version',
      header: t('table.appVersion'),
      render: item => <span className="text-muted-foreground">{item.app_version || '-'}</span>,
    },
    {
      key: 'upvote_count',
      header: t('table.upvotes'),
      sortable: true,
      render: item => (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <ThumbsUp className="h-3.5 w-3.5" />
          {item.upvote_count}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: t('table.reportedOn'),
      sortable: true,
      render: item => <span className="text-muted-foreground">{formatDate(item.created_at)}</span>,
    },
  ];

  const selected = props.reports.find(r => r.id === selectedId) ?? null;

  return (
    <>
      <DataTable<AdminBugReport>
        items={props.reports}
        columns={columns}
        idField="id"
        currentPage={props.currentPage}
        totalPages={props.totalPages}
        totalItems={props.totalItems}
        pageSize={props.pageSize}
        sortBy={props.sortBy}
        sortOrder={props.sortOrder}
        emptyIcon={<Bug className="h-12 w-12 text-muted-foreground/50" />}
        emptyMessage={t('empty')}
        onRowClick={item => setSelectedId(item.id)}
        selectable={false}
        paginationNamespace="admin.bugReports.pagination"
      />

      <AdminBugReportDialog
        report={selected}
        open={!!selected}
        canTriage={props.canTriage}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}

export function BugReportsFilters() {
  const t = useTranslations('admin.bugReports');

  const filters: FilterDef[] = [
    {
      key: 'filter[q]',
      type: 'search',
      placeholder: t('filters.searchPlaceholder'),
    },
    {
      key: 'filter[status]',
      type: 'select',
      placeholder: t('filters.allStatuses'),
      options: BUG_STATUSES.map(s => ({ value: s, label: t(`status.${s}`) })),
    },
    {
      key: 'filter[severity]',
      type: 'select',
      placeholder: t('filters.allSeverities'),
      options: BUG_SEVERITIES.map(s => ({ value: s, label: t(`severity.${s}`) })),
    },
    {
      key: 'filter[module]',
      type: 'select',
      placeholder: t('filters.allModules'),
      options: FEEDBACK_MODULES.map(m => ({ value: m, label: t(`module.${m}`) })),
    },
    {
      key: 'filter[visibility]',
      type: 'select',
      placeholder: t('filters.allVisibilities'),
      options: [
        { value: 'public', label: t('filters.visible') },
        { value: 'hidden', label: t('filters.hidden') },
      ],
    },
  ];

  return <DataTableFilters filters={filters} clearLabel={t('filters.clearFilters')} />;
}
