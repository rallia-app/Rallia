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
import { useBans, type BanFilters } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { CreateBanDialog } from './create-ban-dialog';

export function BansDataTable() {
  const t = useTranslations('admin.moderation');
  const [filters, setFiltersState] = useState<BanFilters>({});
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [showCreateBan, setShowCreateBan] = useState(false);

  const { bans, activeBansCount, isLoading, hasMore, setFilters, loadMore, revokeBan, createBan } =
    useBans({ filters });

  const handleFilterChange = useCallback(
    (key: keyof BanFilters, value: string | undefined) => {
      const newFilters: BanFilters = { ...filters };
      if (key === 'isActive') {
        newFilters.isActive = value === 'all' ? undefined : value === 'true';
      } else if (key === 'banType') {
        newFilters.banType = value === 'all' ? undefined : (value as BanFilters['banType']);
      }
      setFiltersState(newFilters);
      setFilters(newFilters);
    },
    [filters, setFilters]
  );

  const handleRevoke = useCallback(async () => {
    if (!revokeId) return;
    setRevoking(true);
    await revokeBan(revokeId, revokeReason || undefined);
    setRevoking(false);
    setRevokeId(null);
    setRevokeReason('');
  }, [revokeId, revokeReason, revokeBan]);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary + Create */}
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-xs">
          {t('activeBans')}: {activeBansCount}
        </Badge>
        <Button size="sm" onClick={() => setShowCreateBan(true)}>
          {t('createBan')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.isActive === undefined ? 'all' : String(filters.isActive)}
          onValueChange={v => handleFilterChange('isActive', v)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder={t('filterStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filterStatus')}</SelectItem>
            <SelectItem value="true">{t('active')}</SelectItem>
            <SelectItem value="false">{t('revoked')}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.banType ?? 'all'}
          onValueChange={v => handleFilterChange('banType', v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t('banTypeLabel')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('banTypeLabel')}</SelectItem>
            <SelectItem value="temporary">{t('banType.temporary')}</SelectItem>
            <SelectItem value="permanent">{t('banType.permanent')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading && bans.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : bans.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground m-0">{t('noBans')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('player')}</TableHead>
                  <TableHead>{t('banTypeLabel')}</TableHead>
                  <TableHead>{t('reasonLabel')}</TableHead>
                  <TableHead>{t('bannedOn')}</TableHead>
                  <TableHead>{t('expiresOn')}</TableHead>
                  <TableHead>{t('filterStatus')}</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bans.map(ban => (
                  <TableRow key={ban.id}>
                    <TableCell className="font-medium">
                      {ban.player_name ?? ban.player_id}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {t(`banType.${ban.ban_type}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {ban.reason || t('noReason')}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(ban.start_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {ban.end_date ? new Date(ban.end_date).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs border-0 ${
                          ban.is_active
                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-400'
                        }`}
                      >
                        {ban.is_active ? t('active') : t('revoked')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ban.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevokeId(ban.id)}
                        >
                          {t('revokeBan')}
                        </Button>
                      )}
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

      {/* Revoke Confirmation Dialog */}
      <Dialog open={!!revokeId} onOpenChange={v => !v && setRevokeId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('revokeTitle')}</DialogTitle>
            <DialogDescription>{t('revokeConfirm')}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              value={revokeReason}
              onChange={e => setRevokeReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeId(null)} disabled={revoking}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={revoking}>
              {revoking ? t('submitting') : t('revokeBan')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Ban Dialog */}
      <CreateBanDialog
        open={showCreateBan}
        onClose={() => setShowCreateBan(false)}
        onCreateBan={createBan}
      />
    </div>
  );
}
