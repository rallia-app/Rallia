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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useDebounce } from '@rallia/shared-hooks';
import { Moon, Send, Sun, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface BroadcastHistory {
  id: string;
  subject: string;
  recipients_total: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_at: string;
}

interface Feedback {
  type: 'success' | 'error';
  message: string;
}

const LOCALE_OPTIONS = ['en-US', 'fr-CA'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a free-form list on commas/semicolons/whitespace into deduped valid + invalid entries. */
function parseEmailList(raw: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,;]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const email = trimmed.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push(email);
  }
  return { valid, invalid };
}

export function AdminEmailsView() {
  const t = useTranslations('admin.emails');
  const locale = useLocale();

  // ---- Compose state ----
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');

  // ---- Recipients state ----
  const [recipientEmails, setRecipientEmails] = useState('');

  // ---- Preview state ----
  const [previewLocale, setPreviewLocale] = useState(locale === 'fr-CA' ? 'fr-CA' : 'en-US');
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');

  // ---- Async state ----
  const [isSending, setIsSending] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [history, setHistory] = useState<BroadcastHistory[]>([]);

  const hasContent = subject.trim().length > 0 && body.trim().length > 0;

  const { valid: validEmails, invalid: invalidEmails } = useMemo(
    () => parseEmailList(recipientEmails),
    [recipientEmails]
  );
  const recipientCount = validEmails.length;

  // ---- Live preview iframe (debounced) ----
  const debouncedSubject = useDebounce(subject, 400);
  const debouncedBody = useDebounce(body, 400);
  const debouncedCtaText = useDebounce(ctaText, 400);
  const debouncedCtaUrl = useDebounce(ctaUrl, 400);

  const iframeSrc = useMemo(() => {
    if (!debouncedSubject.trim() || !debouncedBody.trim()) return null;
    const params = new URLSearchParams({
      template: 'admin_broadcast',
      locale: previewLocale,
      mode: colorMode,
      title: debouncedSubject,
      body: debouncedBody,
    });
    if (debouncedCtaText.trim() && debouncedCtaUrl.trim()) {
      params.set('ctaText', debouncedCtaText);
      params.set('ctaUrl', debouncedCtaUrl);
    }
    return `/api/admin/email-preview?${params.toString()}`;
  }, [
    debouncedSubject,
    debouncedBody,
    debouncedCtaText,
    debouncedCtaUrl,
    previewLocale,
    colorMode,
  ]);

  // ---- History ----
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/broadcasts');
      const data = (await res.json()) as { broadcasts?: BroadcastHistory[] };
      if (Array.isArray(data.broadcasts)) setHistory(data.broadcasts);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // ---- Actions ----
  const handleSendTest = async () => {
    if (!hasContent) {
      setFeedback({ type: 'error', message: t('toast.validation') });
      return;
    }
    setIsTesting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          subject,
          body,
          ctaText,
          ctaUrl,
          locale: previewLocale,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        testEmail?: string;
        error?: string;
      };
      if (res.ok && data.success) {
        setFeedback({
          type: 'success',
          message: t('toast.testSent', { email: data.testEmail ?? '' }),
        });
      } else {
        setFeedback({ type: 'error', message: data.error ?? t('toast.testFailed') });
      }
    } catch {
      setFeedback({ type: 'error', message: t('toast.testFailed') });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSend = async () => {
    setConfirmOpen(false);
    setIsSending(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          subject,
          body,
          ctaText,
          ctaUrl,
          emails: validEmails,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        sent?: number;
        total?: number;
        error?: string;
      };
      if (res.ok && data.success) {
        setFeedback({
          type: 'success',
          message: t('toast.sent', { sent: data.sent ?? 0, total: data.total ?? 0 }),
        });
        void loadHistory();
      } else {
        setFeedback({ type: 'error', message: data.error ?? t('toast.sendFailed') });
      }
    } catch {
      setFeedback({ type: 'error', message: t('toast.sendFailed') });
    } finally {
      setIsSending(false);
    }
  };

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'queued':
        return t('status.queued');
      case 'sending':
        return t('status.sending');
      case 'sent':
        return t('status.sent');
      case 'partial':
        return t('status.partial');
      case 'failed':
        return t('status.failed');
      default:
        return status;
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: compose + recipients */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('compose.heading')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="broadcast-subject">{t('compose.subjectLabel')}</Label>
                <Input
                  id="broadcast-subject"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder={t('compose.subjectPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="broadcast-body">{t('compose.bodyLabel')}</Label>
                <Textarea
                  id="broadcast-body"
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder={t('compose.bodyPlaceholder')}
                  rows={8}
                />
              </div>

              <div className="rounded-lg border p-4 space-y-4">
                <p className="text-sm font-medium text-muted-foreground">
                  {t('compose.ctaHeading')}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="broadcast-cta-text">{t('compose.ctaTextLabel')}</Label>
                  <Input
                    id="broadcast-cta-text"
                    value={ctaText}
                    onChange={e => setCtaText(e.target.value)}
                    placeholder={t('compose.ctaTextPlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="broadcast-cta-url">{t('compose.ctaUrlLabel')}</Label>
                  <Input
                    id="broadcast-cta-url"
                    value={ctaUrl}
                    onChange={e => setCtaUrl(e.target.value)}
                    placeholder={t('compose.ctaUrlPlaceholder')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('recipients.heading')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="broadcast-recipients">{t('recipients.label')}</Label>
                <Textarea
                  id="broadcast-recipients"
                  value={recipientEmails}
                  onChange={e => setRecipientEmails(e.target.value)}
                  placeholder={t('recipients.placeholder')}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground">{t('recipients.help')}</p>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Users className="size-4 text-muted-foreground" />
                  {t('recipients.count', { count: recipientCount })}
                </span>
                {invalidEmails.length > 0 && (
                  <span className="text-sm text-amber-600 dark:text-amber-400">
                    {t('recipients.invalid', { count: invalidEmails.length })}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => void handleSendTest()}
              disabled={!hasContent || isTesting}
            >
              {isTesting ? t('actions.sending') : t('actions.sendTest')}
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!hasContent || isSending || recipientCount === 0}
            >
              <Send className="mr-2 size-4" />
              {isSending ? t('actions.sending') : t('actions.send')}
            </Button>
          </div>

          {feedback && (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                'rounded-lg border px-4 py-3 text-sm',
                feedback.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200'
                  : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200'
              )}
            >
              {feedback.message}
            </div>
          )}
        </div>

        {/* Right: preview */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t('preview.heading')}</h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-md border">
                {LOCALE_OPTIONS.map(l => (
                  <Button
                    key={l}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 rounded-none text-xs px-3 first:rounded-l-md last:rounded-r-md',
                      previewLocale === l &&
                        'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                    )}
                    onClick={() => setPreviewLocale(l)}
                  >
                    {l.toUpperCase()}
                  </Button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setColorMode(prev => (prev === 'light' ? 'dark' : 'light'))}
              >
                {colorMode === 'dark' ? (
                  <Sun className="size-3.5" />
                ) : (
                  <Moon className="size-3.5" />
                )}
                {colorMode === 'dark' ? t('preview.light') : t('preview.dark')}
              </Button>
            </div>
          </div>
          <div className="border rounded-lg overflow-hidden bg-card" style={{ height: '70vh' }}>
            {iframeSrc ? (
              <iframe
                key={`${previewLocale}-${colorMode}`}
                src={iframeSrc}
                className="w-full h-full border-0"
                style={{ backgroundColor: colorMode === 'dark' ? '#1a1a1a' : '#ffffff' }}
                title="Email preview"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {t('preview.empty')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>{t('history.heading')}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t('history.subject')}</th>
                    <th className="py-2 pr-4 font-medium">{t('history.recipients')}</th>
                    <th className="py-2 pr-4 font-medium">{t('history.sent')}</th>
                    <th className="py-2 pr-4 font-medium">{t('history.failed')}</th>
                    <th className="py-2 pr-4 font-medium">{t('history.status')}</th>
                    <th className="py-2 pr-4 font-medium">{t('history.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(b => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 max-w-[280px] truncate">{b.subject}</td>
                      <td className="py-2 pr-4">{b.recipients_total}</td>
                      <td className="py-2 pr-4">{b.sent_count}</td>
                      <td className="py-2 pr-4">{b.failed_count}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="secondary">{statusLabel(b.status)}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(b.created_at).toLocaleDateString(locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirm.description', { count: recipientCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSend()}>
              {t('confirm.confirm', { count: recipientCount })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
