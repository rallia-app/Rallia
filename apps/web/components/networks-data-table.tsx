'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
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
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminNetworks,
  useCertifyNetwork,
  useDeleteNetwork,
  type AdminNetworkFilters,
} from '@rallia/shared-hooks';
import { MoreHorizontal, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

export function NetworksDataTable() {
  const t = useTranslations('admin.moderation');
  const [filtersState, setFiltersState] = useState<AdminNetworkFilters>({});
  const { networks, totalCount, loading, hasMore, setFilters, loadMore, refetch } =
    useAdminNetworks({ filters: filtersState });
  const { certify, loading: certifyLoading } = useCertifyNetwork();
  const { deleteNetworkFn, loading: deleteLoading } = useDeleteNetwork();

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const handleFilterChange = useCallback(
    (key: keyof AdminNetworkFilters, value: string | undefined) => {
      const newFilters: AdminNetworkFilters = { ...filtersState };
      if (key === 'networkType') {
        newFilters.networkType =
          value === 'all' ? undefined : (value as AdminNetworkFilters['networkType']);
      } else if (key === 'isCertified') {
        newFilters.isCertified = value === 'all' ? undefined : value === 'true';
      }
      setFiltersState(newFilters);
      setFilters(newFilters);
    },
    [filtersState, setFilters]
  );

  const handleSearch = useCallback(() => {
    const newFilters = { ...filtersState, searchQuery: searchInput || undefined };
    setFiltersState(newFilters);
    setFilters(newFilters);
  }, [filtersState, searchInput, setFilters]);

  const handleCertify = useCallback(
    async (networkId: string, isCertified: boolean) => {
      await certify(networkId, isCertified);
      refetch();
    },
    [certify, refetch]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteId) return;
    await deleteNetworkFn(deleteId, deleteReason || undefined);
    setDeleteId(null);
    setDeleteReason('');
    refetch();
  }, [deleteId, deleteReason, deleteNetworkFn, refetch]);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <Badge variant="outline" className="text-xs w-fit">
        {t('total')}: {totalCount}
      </Badge>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9 w-[220px]"
            placeholder={t('searchNetworks')}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
        </div>

        <Select
          value={filtersState.networkType ?? 'all'}
          onValueChange={v => handleFilterChange('networkType', v)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={t('filterType')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allTypes')}</SelectItem>
            <SelectItem value="player_group">{t('group')}</SelectItem>
            <SelectItem value="community">{t('community')}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filtersState.isCertified === undefined ? 'all' : String(filtersState.isCertified)}
          onValueChange={v => handleFilterChange('isCertified', v)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={t('certification')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('certification')}</SelectItem>
            <SelectItem value="true">{t('certified')}</SelectItem>
            <SelectItem value="false">{t('notCertified')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading && networks.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : networks.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground m-0">{t('noNetworks')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('player')}</TableHead>
                  <TableHead>{t('filterType')}</TableHead>
                  <TableHead>Sport</TableHead>
                  <TableHead className="text-right">{t('members')}</TableHead>
                  <TableHead>{t('certification')}</TableHead>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {networks.map(network => (
                  <TableRow key={network.id}>
                    <TableCell className="font-medium">{network.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {network.network_type_display}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {network.sport_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">{network.member_count}</TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs border-0 ${
                          network.is_certified
                            ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-400'
                        }`}
                      >
                        {network.is_certified ? t('certified') : t('notCertified')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(network.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {network.network_type === 'community' && (
                            <DropdownMenuItem
                              onClick={() => handleCertify(network.id, !network.is_certified)}
                              disabled={certifyLoading}
                            >
                              {network.is_certified ? t('removeCertification') : t('certify')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteId(network.id)}
                          >
                            {t('delete')}
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onOpenChange={v => !deleteLoading && !v && setDeleteId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteNetwork')}</DialogTitle>
            <DialogDescription>{t('deleteNetworkConfirm')}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              value={deleteReason}
              onChange={e => setDeleteReason(e.target.value)}
              placeholder={t('deleteReasonPlaceholder')}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleteLoading}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? t('deleting') : t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
