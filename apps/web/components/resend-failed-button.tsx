'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Re-sends a past broadcast to only the recipients whose last attempt failed. */
export function ResendFailedButton({
  broadcastId,
  failedCount,
}: {
  broadcastId: string;
  failedCount: number;
}) {
  const t = useTranslations('admin.emails');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (failedCount <= 0) return null;

  const handleResend = async () => {
    setOpen(false);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend_failed', broadcastId }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        resent?: number;
        error?: string;
      };
      if (res.ok && data.success) {
        setMessage(t('detail.resendDone', { resent: data.resent ?? 0 }));
        router.refresh();
      } else {
        setMessage(data.error ?? t('detail.resendFailed'));
      }
    } catch {
      setMessage(t('detail.resendFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={busy}>
        <RefreshCw className="mr-2 size-4" />
        {busy ? t('detail.resending') : t('detail.resendFailedButton', { count: failedCount })}
      </Button>
      {message && <span className="text-sm text-muted-foreground">{message}</span>}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.resendConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('detail.resendConfirmBody', { count: failedCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleResend()}>
              {t('detail.resendConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
