'use client';

import { Badge } from '@/components/ui/badge';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { useRouter } from '@/i18n/navigation';
import { Users } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';

interface TransformedAdmin {
  id: string;
  role: 'super_admin' | 'moderator' | 'support';
  assigned_at: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  email: string;
}

interface AdminsDataTableProps {
  admins: TransformedAdmin[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export type { TransformedAdmin };

export function AdminsDataTable(props: AdminsDataTableProps) {
  const t = useTranslations('admin.users');
  const locale = useLocale();
  const router = useRouter();

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(dateString));
  };

  const getDisplayName = (admin: TransformedAdmin) =>
    admin.display_name ||
    (admin.first_name && admin.last_name
      ? `${admin.first_name} ${admin.last_name}`
      : admin.first_name) ||
    '-';

  const columns: ColumnDef<TransformedAdmin>[] = [
    {
      key: 'name',
      header: t('table.name'),
      render: item => <span className="font-medium">{getDisplayName(item)}</span>,
    },
    {
      key: 'email',
      header: t('table.email'),
      render: item => <span className="text-muted-foreground">{item.email || '-'}</span>,
    },
    {
      key: 'role',
      header: t('table.role'),
      sortable: true,
      render: item => (
        <Badge variant="outline" className="text-xs">
          {t(`roles.${item.role}`)}
        </Badge>
      ),
    },
    {
      key: 'assigned_at',
      header: t('table.assignedAt'),
      sortable: true,
      render: item => <span className="text-muted-foreground">{formatDate(item.assigned_at)}</span>,
    },
    {
      key: 'status',
      header: t('table.status'),
      render: item => (
        <Badge variant={item.is_active ? 'default' : 'secondary'} className="text-xs">
          {item.is_active ? t('status.active') : t('status.inactive')}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: t('table.createdAt'),
      render: item => <span className="text-muted-foreground">{formatDate(item.created_at)}</span>,
    },
  ];

  return (
    <DataTable<TransformedAdmin>
      items={props.admins}
      columns={columns}
      idField="id"
      currentPage={props.currentPage}
      totalPages={props.totalPages}
      totalItems={props.totalItems}
      pageSize={props.pageSize}
      sortBy={props.sortBy}
      sortOrder={props.sortOrder}
      emptyIcon={<Users className="h-12 w-12 text-muted-foreground/50" />}
      emptyMessage={t('table.noAdmins')}
      onRowClick={item => router.push(`/admin/users/${item.id}`)}
      selectable={false}
    />
  );
}
