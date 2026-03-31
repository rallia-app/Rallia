'use client';

import { Badge } from '@/components/ui/badge';
import {
  DataTable,
  DataTableFilters,
  type ColumnDef,
  type FilterDef,
} from '@/components/data-table';
import { useRouter } from '@/i18n/navigation';
import { Users, Ban } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import type { BulkActionDef } from '@/components/data-table';

export interface TransformedPlayer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string;
  phone: string | null;
  gender: string | null;
  playing_hand: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  reputation_score: number;
  is_active: boolean;
  account_status: string | null;
  onboarding_completed: boolean | null;
  last_seen_at: string | null;
  created_at: string;
}

interface PlayersDataTableProps {
  players: TransformedPlayer[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function PlayersDataTable(props: PlayersDataTableProps) {
  const t = useTranslations('admin.users.players');
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

  const getDisplayName = (player: TransformedPlayer) =>
    (player.first_name && player.last_name
      ? `${player.first_name} ${player.last_name}`
      : player.first_name) ||
    player.display_name ||
    '-';

  const columns: ColumnDef<TransformedPlayer>[] = [
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
      key: 'gender',
      header: t('table.gender'),
      render: item =>
        item.gender ? (
          <Badge variant="outline" className="text-xs">
            {t(`gender.${item.gender}`)}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'city',
      header: t('table.city'),
      render: item => {
        const parts = [item.city, item.province].filter(Boolean);
        return (
          <span className="text-muted-foreground">{parts.length > 0 ? parts.join(', ') : '-'}</span>
        );
      },
    },
    {
      key: 'reputation_score',
      header: t('table.reputation'),
      sortable: true,
      render: item => <span>{item.reputation_score}</span>,
    },
    {
      key: 'account_status',
      header: t('table.status'),
      render: item => {
        const status = item.account_status ?? 'active';
        return (
          <Badge variant={status === 'active' ? 'default' : 'secondary'} className="text-xs">
            {t(`accountStatus.${status}`)}
          </Badge>
        );
      },
    },
    {
      key: 'last_seen_at',
      header: t('table.lastSeen'),
      sortable: true,
      render: item => (
        <span className="text-muted-foreground">{formatDate(item.last_seen_at)}</span>
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
      label: t('bulkActions.suspend'),
      variant: 'destructive',
      icon: <Ban className="h-4 w-4 mr-2" />,
      confirmTitle: t('bulkActions.confirmTitle'),
      confirmDescription: t('bulkActions.confirmDescription', { count: 0 }),
      confirmLabel: t('bulkActions.confirmSuspend'),
      loadingLabel: t('bulkActions.suspending'),
      onExecute: async (ids: string[]) => {
        const response = await fetch('/api/admin/players', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerIds: ids, action: 'suspend' }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to suspend players');
        }
      },
    },
  ];

  return (
    <DataTable<TransformedPlayer>
      items={props.players}
      columns={columns}
      idField="id"
      currentPage={props.currentPage}
      totalPages={props.totalPages}
      totalItems={props.totalItems}
      pageSize={props.pageSize}
      sortBy={props.sortBy}
      sortOrder={props.sortOrder}
      emptyIcon={<Users className="h-12 w-12 text-muted-foreground/50" />}
      emptyMessage={t('table.noPlayers')}
      onRowClick={item => router.push(`/admin/users/${item.id}`)}
      bulkActions={bulkActions}
      bulkSelectedMessage={count => t('bulkActions.selected', { count })}
      paginationNamespace="admin.users.players.pagination"
    />
  );
}

export function PlayersFilters() {
  const t = useTranslations('admin.users.players');

  const filters: FilterDef[] = [
    {
      key: 'filter[name_like]',
      type: 'search',
      placeholder: t('filters.searchPlaceholder'),
    },
    {
      key: 'filter[gender]',
      type: 'select',
      placeholder: t('filters.allGenders'),
      options: [
        { value: 'male', label: t('gender.male') },
        { value: 'female', label: t('gender.female') },
        { value: 'other', label: t('gender.other') },
        { value: 'prefer_not_to_say', label: t('gender.prefer_not_to_say') },
      ],
    },
    {
      key: 'filter[account_status]',
      type: 'select',
      placeholder: t('filters.allStatuses'),
      options: [
        { value: 'active', label: t('accountStatus.active') },
        { value: 'suspended', label: t('accountStatus.suspended') },
        { value: 'deleted', label: t('accountStatus.deleted') },
        { value: 'pending_verification', label: t('accountStatus.pending_verification') },
      ],
    },
  ];

  return <DataTableFilters filters={filters} clearLabel={t('filters.clearFilters')} />;
}
