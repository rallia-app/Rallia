'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type BulkActionDef, type ColumnDef } from '@/components/data-table';
import { BarChart2, Eye, EyeOff, Loader2, Pencil, Trash2, Trophy } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

// ============================================================================
// TYPES
// ============================================================================

interface ReferralContest {
  id: string;
  title: string;
  prize_description: string;
  title_en: string | null;
  title_fr: string | null;
  prize_description_en: string | null;
  prize_description_fr: string | null;
  start_at: string;
  end_at: string;
  max_winners: number;
  is_active: boolean;
  created_at: string;
}

type ContestStatus = 'inactive' | 'upcoming' | 'live' | 'ended';

interface ContestInitialData {
  id: string;
  titleEn: string;
  titleFr: string;
  prizeDescriptionEn: string;
  prizeDescriptionFr: string;
  startAt: string;
  endAt: string;
  maxWinners: number;
  isActive: boolean;
}

interface LeaderboardEntry {
  referrer_id: string;
  display_name: string;
  avatar_url: string | null;
  referral_count: number;
  rank: number;
}

// ============================================================================
// STATUS HELPER
// ============================================================================

function getContestStatus(contest: ReferralContest): ContestStatus {
  if (!contest.is_active) return 'inactive';
  const now = Date.now();
  if (now < new Date(contest.start_at).getTime()) return 'upcoming';
  if (now > new Date(contest.end_at).getTime()) return 'ended';
  return 'live';
}

const STATUS_VARIANT: Record<ContestStatus, 'secondary' | 'outline' | 'default' | 'destructive'> = {
  inactive: 'secondary',
  upcoming: 'outline',
  live: 'default',
  ended: 'destructive',
};

// ============================================================================
// LEADERBOARD DIALOG
// ============================================================================

interface LeaderboardDialogProps {
  contest: ReferralContest | null;
  onClose: () => void;
}

function LeaderboardDialog({ contest, onClose }: LeaderboardDialogProps) {
  const t = useTranslations('admin.referralContests');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = contest ? getContestStatus(contest) : null;
  const isEnded = status === 'ended';

  useEffect(() => {
    if (!contest) return;
    setLoading(true);
    const limit = contest.max_winners * 3;
    fetch(`/api/admin/referral-contests/${contest.id}/leaderboard?limit=${limit}`)
      .then(r => r.json())
      .then(({ data }) => setEntries(data ?? []))
      .finally(() => setLoading(false));
  }, [contest]);

  const handleCopyWinners = useCallback(async () => {
    if (!contest) return;
    const winners = entries.slice(0, contest.max_winners);
    const text = winners
      .map(e => `${e.rank}. ${e.display_name} — ${e.referral_count} referrals`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [entries, contest]);

  return (
    <Dialog open={!!contest} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {isEnded ? t('leaderboard.winners') : t('leaderboard.title')}
            {contest && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {contest.title}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{t('leaderboard.loading')}</span>
            </div>
          ) : entries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              {t('leaderboard.noEntries')}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {entries.map((entry, i) => {
                const isWinner = contest ? i < contest.max_winners : false;
                return (
                  <div
                    key={entry.referrer_id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md ${
                      isWinner && isEnded ? 'bg-amber-50 dark:bg-amber-950/30' : ''
                    }`}
                  >
                    <span className="w-8 text-center text-sm font-bold text-muted-foreground">
                      #{entry.rank}
                    </span>
                    {isWinner && isEnded && <Trophy className="h-4 w-4 text-amber-500 shrink-0" />}
                    <span className="flex-1 text-sm font-medium truncate">
                      {entry.display_name}
                    </span>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {entry.referral_count} {t('leaderboard.referrals')}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          {isEnded && entries.length > 0 && (
            <Button variant="outline" onClick={handleCopyWinners} disabled={copied}>
              {copied ? t('leaderboard.copied') : t('leaderboard.copyWinners')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// CONTEST DIALOG (create / edit)
// ============================================================================

interface ReferralContestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: ContestInitialData;
}

export function ReferralContestDialog({
  open,
  onOpenChange,
  initialData,
}: ReferralContestDialogProps) {
  const t = useTranslations('admin.referralContests');
  const router = useRouter();
  const isEditMode = !!initialData;

  const [titleEn, setTitleEn] = useState('');
  const [titleFr, setTitleFr] = useState('');
  const [prizeDescriptionEn, setPrizeDescriptionEn] = useState('');
  const [prizeDescriptionFr, setPrizeDescriptionFr] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [maxWinners, setMaxWinners] = useState(3);
  const [isActive, setIsActive] = useState(true);
  const [dateError, setDateError] = useState('');
  const [apiError, setApiError] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open && initialData) {
      setTitleEn(initialData.titleEn);
      setTitleFr(initialData.titleFr);
      setPrizeDescriptionEn(initialData.prizeDescriptionEn);
      setPrizeDescriptionFr(initialData.prizeDescriptionFr);
      setStartAt(initialData.startAt.slice(0, 16));
      setEndAt(initialData.endAt.slice(0, 16));
      setMaxWinners(initialData.maxWinners);
      setIsActive(initialData.isActive);
      setDateError('');
      setApiError('');
    } else if (!open && !isEditMode) {
      setTitleEn('');
      setTitleFr('');
      setPrizeDescriptionEn('');
      setPrizeDescriptionFr('');
      setStartAt('');
      setEndAt('');
      setMaxWinners(3);
      setIsActive(true);
      setDateError('');
      setApiError('');
    }
  }, [open, initialData, isEditMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDateError('');
    setApiError('');

    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
      setDateError(t('dialog.endBeforeStart'));
      return;
    }

    startTransition(async () => {
      const body = {
        titleEn,
        titleFr: titleFr || null,
        prizeDescriptionEn,
        prizeDescriptionFr: prizeDescriptionFr || null,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        maxWinners,
        isActive,
        ...(isEditMode && { id: initialData!.id }),
      };

      const response = await fetch('/api/admin/referral-contests', {
        method: isEditMode ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.status === 409) {
        setApiError(t('errors.anotherActive'));
        return;
      }

      if (response.ok) {
        onOpenChange(false);
        router.refresh();
      } else {
        const err = await response.json().catch(() => ({}));
        setApiError(err.message ?? 'An error occurred');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditMode ? t('dialog.editTitle') : t('dialog.createTitle')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-title-en">{t('dialog.titleEnLabel')}</Label>
              <Input
                id="rc-title-en"
                value={titleEn}
                onChange={e => setTitleEn(e.target.value)}
                placeholder={t('dialog.titleEnPlaceholder')}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-title-fr">{t('dialog.titleFrLabel')}</Label>
              <Input
                id="rc-title-fr"
                value={titleFr}
                onChange={e => setTitleFr(e.target.value)}
                placeholder={t('dialog.titleFrPlaceholder')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-prize-en">{t('dialog.prizeEnLabel')}</Label>
              <Input
                id="rc-prize-en"
                value={prizeDescriptionEn}
                onChange={e => setPrizeDescriptionEn(e.target.value)}
                placeholder={t('dialog.prizeEnPlaceholder')}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-prize-fr">{t('dialog.prizeFrLabel')}</Label>
              <Input
                id="rc-prize-fr"
                value={prizeDescriptionFr}
                onChange={e => setPrizeDescriptionFr(e.target.value)}
                placeholder={t('dialog.prizeFrPlaceholder')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-start">{t('dialog.startAtLabel')}</Label>
              <Input
                id="rc-start"
                type="datetime-local"
                value={startAt}
                onChange={e => {
                  setStartAt(e.target.value);
                  setDateError('');
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-end">{t('dialog.endAtLabel')}</Label>
              <Input
                id="rc-end"
                type="datetime-local"
                value={endAt}
                onChange={e => {
                  setEndAt(e.target.value);
                  setDateError('');
                }}
                required
                className={dateError ? 'border-destructive' : ''}
              />
              {dateError && <p className="text-xs text-destructive">{dateError}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-winners">{t('dialog.maxWinnersLabel')}</Label>
            <Input
              id="rc-winners"
              type="number"
              min={1}
              value={maxWinners}
              onChange={e => setMaxWinners(Number(e.target.value))}
              required
              className="w-24"
            />
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="rc-active"
              checked={isActive}
              onCheckedChange={checked => {
                setIsActive(!!checked);
                setApiError('');
              }}
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="rc-active" className="cursor-pointer">
                {t('dialog.isActiveLabel')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('dialog.isActiveDescription')}</p>
            </div>
          </div>

          {apiError && <p className="text-sm text-destructive">{apiError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('dialog.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isEditMode ? t('dialog.saving') : t('dialog.creating')}
                </>
              ) : (
                t('dialog.save')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DATA TABLE
// ============================================================================

interface ReferralContestsDataTableProps {
  contests: ReferralContest[];
}

export function ReferralContestsDataTable({ contests }: ReferralContestsDataTableProps) {
  const t = useTranslations('admin.referralContests');
  const locale = useLocale();
  const router = useRouter();
  const [editDialog, setEditDialog] = useState<ContestInitialData | null>(null);
  const [leaderboardContest, setLeaderboardContest] = useState<ReferralContest | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const formatDate = (dateString: string) =>
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateString));

  const handleToggleActive = async (contest: ReferralContest) => {
    setTogglingId(contest.id);
    setToggleError(null);
    try {
      const response = await fetch('/api/admin/referral-contests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: contest.id, isActive: !contest.is_active }),
      });

      if (response.status === 409) {
        setToggleError(t('errors.anotherActive'));
        return;
      }

      if (response.ok) {
        router.refresh();
      }
    } finally {
      setTogglingId(null);
    }
  };

  const columns: ColumnDef<ReferralContest>[] = [
    {
      key: 'title',
      header: t('table.title'),
      render: item => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{item.title_en ?? item.title}</span>
          {item.title_fr && <span className="text-xs text-muted-foreground">{item.title_fr}</span>}
        </div>
      ),
    },
    {
      key: 'prize_description',
      header: t('table.prize'),
      render: item => (
        <div className="flex flex-col gap-0.5 max-w-48">
          <span className="text-muted-foreground truncate block">
            {item.prize_description_en ?? item.prize_description}
          </span>
          {item.prize_description_fr && (
            <span className="text-xs text-muted-foreground truncate block">
              {item.prize_description_fr}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'start_at',
      header: t('table.startAt'),
      render: item => <span className="text-muted-foreground">{formatDate(item.start_at)}</span>,
    },
    {
      key: 'end_at',
      header: t('table.endAt'),
      render: item => <span className="text-muted-foreground">{formatDate(item.end_at)}</span>,
    },
    {
      key: 'max_winners',
      header: t('table.maxWinners'),
      render: item => <span className="text-center block">{item.max_winners}</span>,
    },
    {
      key: 'is_active',
      header: t('table.status'),
      render: item => {
        const status = getContestStatus(item);
        return <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>;
      },
    },
    {
      key: 'created_at',
      header: t('table.createdAt'),
      render: item => (
        <span className="text-muted-foreground">
          {new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }).format(new Date(item.created_at))}
        </span>
      ),
    },
    {
      key: 'id',
      header: t('table.actions'),
      render: item => (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            title={t('leaderboard.title')}
            onClick={() => setLeaderboardContest(item)}
          >
            <BarChart2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('edit')}
            onClick={() =>
              setEditDialog({
                id: item.id,
                titleEn: item.title_en ?? item.title,
                titleFr: item.title_fr ?? '',
                prizeDescriptionEn: item.prize_description_en ?? item.prize_description,
                prizeDescriptionFr: item.prize_description_fr ?? '',
                startAt: item.start_at,
                endAt: item.end_at,
                maxWinners: item.max_winners,
                isActive: item.is_active,
              })
            }
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('toggleActive')}
            disabled={togglingId === item.id}
            onClick={() => handleToggleActive(item)}
          >
            {togglingId === item.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : item.is_active ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        </div>
      ),
    },
  ];

  const bulkActions: BulkActionDef[] = [
    {
      label: t('bulkActions.delete'),
      variant: 'destructive',
      icon: <Trash2 className="h-4 w-4 mr-2" />,
      confirmTitle: t('bulkActions.confirmTitle'),
      confirmDescription: (count: number) => t('bulkActions.confirmDescription', { count }),
      confirmLabel: t('bulkActions.confirmDelete'),
      loadingLabel: t('bulkActions.deleting'),
      onExecute: async (ids: string[]) => {
        const response = await fetch('/api/admin/referral-contests', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contestIds: ids }),
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to delete contests');
        }
      },
    },
  ];

  return (
    <>
      {toggleError && <p className="text-sm text-destructive mb-2">{toggleError}</p>}
      <ReferralContestDialog
        open={!!editDialog}
        onOpenChange={open => !open && setEditDialog(null)}
        initialData={editDialog ?? undefined}
      />
      <LeaderboardDialog contest={leaderboardContest} onClose={() => setLeaderboardContest(null)} />
      <DataTable<ReferralContest>
        items={contests}
        columns={columns}
        idField="id"
        currentPage={1}
        totalPages={1}
        totalItems={contests.length}
        pageSize={contests.length || 10}
        emptyIcon={<Trophy className="h-12 w-12 text-muted-foreground/50" />}
        emptyMessage={t('table.noContests')}
        bulkActions={bulkActions}
        bulkSelectedMessage={count => t('bulkActions.selected', { count })}
      />
    </>
  );
}
