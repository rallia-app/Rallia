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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { BanType, CreateBanParams, PlayerBan } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface CreateBanDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateBan: (params: CreateBanParams) => Promise<PlayerBan | null>;
  initialPlayerId?: string;
}

export function CreateBanDialog({
  open,
  onClose,
  onCreateBan,
  initialPlayerId,
}: CreateBanDialogProps) {
  const t = useTranslations('admin.moderation');
  const [playerId, setPlayerId] = useState(initialPlayerId ?? '');
  const [banType, setBanType] = useState<BanType>('temporary');
  const [durationDays, setDurationDays] = useState('7');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialPlayerId) setPlayerId(initialPlayerId);
  }, [initialPlayerId]);

  const resetForm = () => {
    setPlayerId(initialPlayerId ?? '');
    setBanType('temporary');
    setDurationDays('7');
    setReason('');
  };

  const handleSubmit = async () => {
    if (!playerId.trim() || !reason.trim()) return;

    setSubmitting(true);

    const endDate =
      banType === 'temporary'
        ? new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

    const result = await onCreateBan({
      playerId: playerId.trim(),
      banType,
      reason: reason.trim(),
      endDate,
    });

    setSubmitting(false);

    if (result) {
      resetForm();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('createBan')}</DialogTitle>
          <DialogDescription>{t('banningPlayer')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t('playerId')}</Label>
            <Input
              value={playerId}
              onChange={e => setPlayerId(e.target.value)}
              placeholder={t('playerIdPlaceholder')}
              readOnly={!!initialPlayerId}
              className={initialPlayerId ? 'bg-muted' : ''}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('banTypeLabel')}</Label>
            <Select value={banType} onValueChange={v => setBanType(v as BanType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="temporary">{t('banType.temporary')}</SelectItem>
                <SelectItem value="permanent">{t('banType.permanent')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {banType === 'temporary' && (
            <div className="space-y-1.5">
              <Label>{t('durationDays')}</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={durationDays}
                onChange={e => setDurationDays(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t('reasonLabel')}</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={submitting || !playerId.trim() || !reason.trim()}
          >
            {submitting ? t('submitting') : t('confirmBan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
