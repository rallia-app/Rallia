'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import type { PlayerReport, ReportStatus } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface ReportReviewDialogProps {
  report: PlayerReport | null;
  open: boolean;
  onClose: () => void;
  onReview: (
    reportId: string,
    status: ReportStatus,
    actionTaken?: string,
    notes?: string
  ) => Promise<boolean>;
}

const REVIEW_STATUSES: ReportStatus[] = ['under_review', 'action_taken', 'dismissed', 'escalated'];

export function ReportReviewDialog({ report, open, onClose, onReview }: ReportReviewDialogProps) {
  const t = useTranslations('admin.moderation');
  const [status, setStatus] = useState<ReportStatus>('under_review');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!report) return;
    setSubmitting(true);
    const success = await onReview(report.id, status, undefined, notes || undefined);
    setSubmitting(false);
    if (success) {
      setStatus('under_review');
      setNotes('');
      onClose();
    }
  };

  if (!report) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('review')}</DialogTitle>
          <DialogDescription>
            {t('reportType.' + report.report_type)} — {t('priority.' + report.priority)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Report info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">{t('reporter')}</span>
              <p className="font-medium m-0 mt-0.5">{report.reporter_name}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t('reportedPlayer')}</span>
              <p className="font-medium m-0 mt-0.5">{report.reported_player_name}</p>
            </div>
          </div>

          {/* Description */}
          {report.description && (
            <div className="text-sm">
              <span className="text-muted-foreground">{t('description')}</span>
              <p className="m-0 mt-1 rounded-md border p-3 bg-muted/30">{report.description}</p>
            </div>
          )}

          {/* Evidence */}
          {report.evidence_urls && report.evidence_urls.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">{t('evidence')}</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {report.evidence_urls.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline text-xs"
                  >
                    {t('evidenceImage')} {i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Current status */}
          <div className="text-sm">
            <span className="text-muted-foreground">{t('filterStatus')}</span>
            <div className="mt-1">
              <Badge variant="outline">{t(`status.${report.status}`)}</Badge>
            </div>
          </div>

          {/* Status select */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('updateStatus')}</label>
            <Select value={status} onValueChange={v => setStatus(v as ReportStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('adminNotes')}</label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('submitting') : t('submitReview')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
