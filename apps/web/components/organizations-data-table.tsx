'use client';

import { Badge } from '@/components/ui/badge';
import {
  DataTable,
  DataTableFilters,
  type ColumnDef,
  type FilterDef,
} from '@/components/data-table';
import { Tables } from '@/types';
import { Building2, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import type { BulkActionDef } from '@/components/data-table';

type Organization = Pick<
  Tables<'organization'>,
  'id' | 'name' | 'email' | 'phone' | 'website' | 'nature' | 'slug' | 'is_active' | 'created_at'
>;

interface OrganizationsDataTableProps {
  organizations: Organization[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function OrganizationsDataTable(props: OrganizationsDataTableProps) {
  const t = useTranslations('admin.organizations');
  const router = useRouter();
  const locale = useLocale();

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(dateString));
  };

  const columns: ColumnDef<Organization>[] = [
    {
      key: 'name',
      header: t('table.name'),
      sortable: true,
      render: item => <span className="font-medium">{item.name}</span>,
    },
    {
      key: 'email',
      header: t('table.email'),
      sortable: true,
      render: item => <span className="text-muted-foreground">{item.email || '-'}</span>,
    },
    {
      key: 'phone',
      header: t('table.phone'),
      render: item => <span className="text-muted-foreground">{item.phone || '-'}</span>,
    },
    {
      key: 'website',
      header: t('table.website'),
      render: item =>
        item.website ? (
          <a
            href={item.website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-primary hover:underline"
          >
            {item.website.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'nature',
      header: t('table.nature'),
      sortable: true,
      render: item =>
        item.nature ? (
          <Badge variant="outline" className="text-xs">
            {t(`nature.${item.nature}`)}
          </Badge>
        ) : (
          '-'
        ),
    },
    {
      key: 'is_active',
      header: t('table.status'),
      sortable: true,
      render: item => (
        <Badge variant={item.is_active ? 'default' : 'secondary'} className="text-xs">
          {item.is_active ? t('status.active') : t('status.inactive')}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: t('table.createdAt'),
      sortable: true,
      render: item => <span className="text-muted-foreground">{formatDate(item.created_at)}</span>,
    },
  ];

  const bulkActions: BulkActionDef[] = [
    {
      label: t('bulkActions.delete'),
      variant: 'destructive',
      icon: <Trash2 className="h-4 w-4 mr-2" />,
      confirmTitle: t('bulkActions.confirmTitle'),
      confirmDescription: t('bulkActions.confirmDescription', {
        count: 0, // Will be overridden by selectedMessage
      }),
      confirmLabel: t('bulkActions.confirmDelete'),
      loadingLabel: t('bulkActions.deleting'),
      onExecute: async (ids: string[]) => {
        const response = await fetch('/api/admin/organizations', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationIds: ids }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to delete organizations');
        }
      },
    },
  ];

  return (
    <DataTable<Organization>
      items={props.organizations}
      columns={columns}
      idField="id"
      currentPage={props.currentPage}
      totalPages={props.totalPages}
      totalItems={props.totalItems}
      pageSize={props.pageSize}
      sortBy={props.sortBy}
      sortOrder={props.sortOrder}
      emptyIcon={<Building2 className="h-12 w-12 text-muted-foreground/50" />}
      emptyMessage={t('table.noOrganizations')}
      bulkActions={bulkActions}
      bulkSelectedMessage={count => t('bulkActions.selected', { count })}
      onRowClick={item => router.push(`/admin/organizations/${item.slug}`)}
    />
  );
}

export function OrganizationsFilters() {
  const t = useTranslations('admin.organizations');

  const filters: FilterDef[] = [
    {
      key: 'filter[name_like]',
      type: 'search',
      placeholder: t('filters.searchPlaceholder'),
    },
    {
      key: 'filter[nature]',
      type: 'select',
      placeholder: t('filters.allNatures'),
      options: [
        { value: 'public', label: t('nature.public') },
        { value: 'private', label: t('nature.private') },
      ],
    },
    {
      key: 'filter[is_active]',
      type: 'select',
      placeholder: t('filters.allStatuses'),
      options: [
        { value: 'true', label: t('status.active') },
        { value: 'false', label: t('status.inactive') },
      ],
    },
  ];

  return <DataTableFilters filters={filters} clearLabel={t('filters.clearFilters')} />;
}
