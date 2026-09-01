'use client';

import { Eye, EyeOff, Loader2, ThumbsUp } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import {
  bugMetadata,
  bugSeverity,
  BUG_STATUSES,
  SEVERITY_BADGE,
  STATUS_BADGE,
  type AdminBugReport,
  type BugDeviceInfo,
  type BugStatus,
} from '@/lib/bug-reports';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Link, useRouter } from '@/i18n/navigation';

interface AdminBugReportDialogProps {
  report: AdminBugReport | null;
  open: boolean;
  canTriage: boolean;
  onClose: () => void;
}

export function AdminBugReportDialog({
  report,
  open,
  canTriage,
  onClose,
}: AdminBugReportDialogProps) {
  const t = useTranslations('admin.bugReports');
  const locale = useLocale();
  const router = useRouter();

  const [status, setStatus] = useState<BugStatus>('new');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the triage form whenever a different report is opened.
  useEffect(() => {
    if (!report) return;
    setStatus(
      (BUG_STATUSES as readonly string[]).includes(report.status)
        ? (report.status as BugStatus)
        : 'new'
    );
    setNotes(report.admin_notes ?? '');
    setError(null);
  }, [report]);

  if (!report) return null;

  const meta = bugMetadata(report);
  const severity = bugSeverity(report);
  const device = (report.device_info as BugDeviceInfo | null) ?? {};
  const screenshots = report.screenshot_urls ?? [];
  const isHidden = !!report.hidden_at;

  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value)
    );

  const patch = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/admin/feedback/${report.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('request_failed');
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await patch({ status, adminNotes: notes });
      onClose();
      router.refresh();
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleVisibility = async () => {
    setHiding(true);
    setError(null);
    try {
      await patch({ hidden: !isHidden });
      onClose();
      router.refresh();
    } catch {
      setError(t('saveError'));
    } finally {
      setHiding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('detail.title')}</DialogTitle>
          <DialogDescription>
            {t('detail.reportedOn', { date: formatDateTime(report.created_at) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="flex flex-wrap items-center gap-2">
            {severity && (
              <Badge variant="outline" className={`text-xs border-0 ${SEVERITY_BADGE[severity]}`}>
                {t(`severity.${severity}`)}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-xs border-0 ${STATUS_BADGE[report.status] ?? STATUS_BADGE.closed}`}
            >
              {t(`status.${report.status}`)}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {t(`module.${report.module}`)}
            </Badge>
            <Badge variant="secondary" className="text-xs inline-flex items-center gap-1">
              <ThumbsUp className="h-3 w-3" />
              {report.upvote_count}
            </Badge>
            {isHidden && (
              <Badge variant="outline" className="text-xs inline-flex items-center gap-1">
                <EyeOff className="h-3 w-3" />
                {t('detail.hidden')}
              </Badge>
            )}
          </div>

          <section className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground m-0">
              {t('detail.steps')}
            </p>
            <p className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 p-3 m-0">
              {meta.steps_to_reproduce?.trim() || report.message || t('noDetails')}
            </p>
          </section>

          {meta.expected_vs_actual?.trim() && (
            <section className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground m-0">
                {t('detail.expectedVsActual')}
              </p>
              <p className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 p-3 m-0">
                {meta.expected_vs_actual}
              </p>
            </section>
          )}

          {screenshots.length > 0 && (
            <section className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground m-0">
                {t('detail.screenshots')}
              </p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {screenshots.map((url, index) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative aspect-square rounded-lg overflow-hidden border"
                  >
                    <Image
                      src={url}
                      alt={t('detail.screenshotAlt', { index: index + 1 })}
                      fill
                      className="object-cover"
                      sizes="120px"
                      // Admin-only, low volume: not worth an optimizer round trip.
                      unoptimized
                    />
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground m-0">{t('detail.reporter')}</p>
              {report.reporter ? (
                <Link
                  href={`/admin/users/${report.reporter.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {report.reporter.name}
                </Link>
              ) : (
                <p className="font-medium m-0">{t('anonymous')}</p>
              )}
              {report.reporter?.email && (
                <p className="text-xs text-muted-foreground m-0 break-all">
                  {report.reporter.email}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground m-0">{t('detail.appVersion')}</p>
              <p className="font-medium m-0">{report.app_version || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground m-0">{t('detail.device')}</p>
              <p className="font-medium m-0">
                {[device.platform, device.version].filter(Boolean).join(' ') || '-'}
              </p>
            </div>
            {device.trigger && (
              <div>
                <p className="text-xs text-muted-foreground m-0">{t('detail.trigger')}</p>
                <p className="font-medium m-0">{device.trigger}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground m-0">{t('detail.lastUpdated')}</p>
              <p className="font-medium m-0">{formatDateTime(report.updated_at)}</p>
            </div>
          </section>

          {canTriage && (
            <section className="space-y-4 border-t pt-4">
              <div className="space-y-1.5">
                <Label>{t('detail.updateStatus')}</Label>
                <Select value={status} onValueChange={v => setStatus(v as BugStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUG_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>
                        {t(`status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.adminNotes')}</Label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={t('detail.notesPlaceholder')}
                  rows={3}
                  maxLength={2000}
                />
                <p className="text-xs text-muted-foreground m-0">{t('detail.notesArePublic')}</p>
              </div>

              <div className="flex items-start justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground m-0 max-w-sm">
                  {isHidden ? t('detail.hiddenHint') : t('detail.visibleHint')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleToggleVisibility()}
                  disabled={hiding || saving}
                >
                  {hiding ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : isHidden ? (
                    <Eye className="h-4 w-4 mr-2" />
                  ) : (
                    <EyeOff className="h-4 w-4 mr-2" />
                  )}
                  {isHidden ? t('detail.unhide') : t('detail.hide')}
                </Button>
              </div>
            </section>
          )}

          {error && <p className="text-sm text-destructive m-0">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving || hiding}>
            {t('detail.close')}
          </Button>
          {canTriage && (
            <Button onClick={() => void handleSave()} disabled={saving || hiding}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('detail.save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
