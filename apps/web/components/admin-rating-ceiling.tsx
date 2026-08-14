'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from '@/i18n/navigation';
import { Loader2, TrendingDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface RatingCeilingEntry {
  sportId: string;
  sportName: string;
  currentValue: number;
  ceilingValue: number;
}

interface AdminRatingCeilingProps {
  playerId: string;
  entries: RatingCeilingEntry[];
  canClear: boolean;
}

/**
 * Prize-draw rating ceilings currently holding this player back, with the
 * override for a genuine level drop. Only rendered for sports where the ceiling
 * actually exceeds the current rating, since anywhere else there is nothing to
 * clear and nothing being blocked.
 */
export function AdminRatingCeiling({ playerId, entries, canClear }: AdminRatingCeilingProps) {
  const t = useTranslations('admin.users.detail.ratingCeiling');
  const router = useRouter();

  const [target, setTarget] = useState<RatingCeilingEntry | null>(null);
  const [reason, setReason] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setTarget(null);
    setReason('');
    setError(null);
  };

  const handleClear = async () => {
    if (!target) return;
    setIsClearing(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/rating-ceiling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, sportId: target.sportId, reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(
          body.error === 'NO_ACTIVE_RATING' ? t('errors.noActiveRating') : t('errors.failed')
        );
        return;
      }
      close();
      router.refresh();
    } catch {
      setError(t('errors.failed'));
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <TrendingDown className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <p className="text-sm text-muted-foreground m-0">{t('explainer')}</p>
      </div>

      {entries.map(entry => (
        <div
          key={entry.sportId}
          className="flex items-center justify-between gap-4 border rounded-lg p-3 flex-wrap"
        >
          <div>
            <p className="text-sm font-semibold m-0">{entry.sportName}</p>
            <p className="text-xs text-muted-foreground m-0">
              {t('heldTo', {
                current: entry.currentValue.toFixed(1),
                ceiling: entry.ceilingValue.toFixed(1),
              })}
            </p>
          </div>
          {canClear && (
            <Button variant="outline" size="sm" onClick={() => setTarget(entry)}>
              {t('clear')}
            </Button>
          )}
        </div>
      ))}

      <Dialog open={!!target} onOpenChange={open => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirmTitle')}</DialogTitle>
            <DialogDescription>
              {target
                ? t('confirmDescription', {
                    sport: target.sportName,
                    ceiling: target.ceilingValue.toFixed(1),
                    current: target.currentValue.toFixed(1),
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="ceiling-reason">{t('reasonLabel')}</Label>
            <Textarea
              id="ceiling-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              rows={3}
            />
            <p className="text-xs text-muted-foreground m-0">{t('reasonHint')}</p>
            {error && <p className="text-xs text-destructive m-0">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={isClearing}>
              {t('cancel')}
            </Button>
            <Button onClick={handleClear} disabled={isClearing || reason.trim().length < 5}>
              {isClearing && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
