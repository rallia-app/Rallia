'use client';

import { useState, useTransition } from 'react';
import { Loader2, Megaphone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

import { cn } from '@/lib/utils';

interface SportOption {
  id: string;
  name: string;
}

interface AdminAnnouncementComposerProps {
  sports: SportOption[];
}

// Push bodies truncate around this length (see notify_new_message); the full
// message is still stored and shown in the in-app channel.
const PUSH_PREVIEW_LEN = 178;

const PREVIEW_LOCALES = ['en-US', 'fr-CA'] as const;
type PreviewLocale = (typeof PREVIEW_LOCALES)[number];

/** Mirrors the push copy built by notify_new_message for announcement channels. */
function pushTitle(sportName: string, locale: PreviewLocale): string {
  return locale === 'fr-CA' ? `Annonce ${sportName}` : `${sportName} announcement`;
}

/** Mirrors notify_new_message: rtrim(left(content, 178)) || '…'. */
function pushBody(content: string): { text: string; truncated: boolean } {
  if (content.length <= PUSH_PREVIEW_LEN) return { text: content, truncated: false };
  return { text: `${content.slice(0, PUSH_PREVIEW_LEN).replace(/\s+$/, '')}…`, truncated: true };
}

export function AdminAnnouncementComposer({ sports }: AdminAnnouncementComposerProps) {
  const t = useTranslations('admin.announcements');
  const locale = useLocale();

  const [sportId, setSportId] = useState(sports[0]?.id ?? '');
  const [content, setContent] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<PreviewLocale>(
    locale === 'fr-CA' ? 'fr-CA' : 'en-US'
  );
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [isPending, startTransition] = useTransition();

  const trimmed = content.trim();
  const canSubmit = sportId !== '' && trimmed !== '';

  const errorMessage = (code: string) => {
    switch (code) {
      case 'EMPTY_CONTENT':
      case 'NOT_AUTHORIZED':
      case 'CHANNEL_NOT_FOUND':
        return t(`errors.${code}`);
      default:
        return t('errors.generic');
    }
  };

  const send = () => {
    setFeedback(null);
    startTransition(async () => {
      const response = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sportId, content: trimmed }),
      });

      if (response.ok) {
        setContent('');
        setConfirming(false);
        setFeedback({ type: 'success', message: t('feedback.success') });
        return;
      }

      const body = await response.json().catch(() => ({}));
      setConfirming(false);
      setFeedback({ type: 'error', message: errorMessage(body?.error ?? '') });
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    // Broadcasts to every player of the sport — require an explicit confirm.
    setConfirming(true);
    setFeedback(null);
  };

  const selectedSportName = sports.find(s => s.id === sportId)?.name ?? '';
  const preview = pushBody(trimmed);

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="announcement-sport">{t('form.sportLabel')}</Label>
          <Select
            value={sportId}
            onValueChange={value => {
              setSportId(value);
              setConfirming(false);
            }}
          >
            <SelectTrigger id="announcement-sport" className="w-[240px]">
              <SelectValue placeholder={t('form.sportPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {sports.map(sport => (
                <SelectItem key={sport.id} value={sport.id}>
                  {sport.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="announcement-content">{t('form.messageLabel')}</Label>
          <Textarea
            id="announcement-content"
            value={content}
            onChange={e => {
              setContent(e.target.value);
              setConfirming(false);
            }}
            placeholder={t('form.messagePlaceholder')}
            rows={5}
            className="resize-y"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('form.pushHint')}</span>
            <span className={trimmed.length > PUSH_PREVIEW_LEN ? 'text-amber-600' : undefined}>
              {t('form.charCount', { count: trimmed.length })}
            </span>
          </div>
        </div>

        {feedback && (
          <p
            className={
              feedback.type === 'success'
                ? 'text-sm font-medium text-emerald-600'
                : 'text-sm font-medium text-destructive'
            }
          >
            {feedback.message}
          </p>
        )}

        {confirming ? (
          <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t('form.confirmWarning', { sport: selectedSportName })}
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={send} disabled={isPending}>
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Megaphone className="size-4" />
                )}
                {t('form.confirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={isPending}
              >
                {t('form.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="submit" disabled={!canSubmit || isPending}>
              <Megaphone className="size-4" />
              {t('form.submit')}
            </Button>
          </div>
        )}
      </form>

      {/* Live preview of the push notification + in-app channel message */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('preview.heading')}</h3>
          <div className="flex items-center rounded-md border">
            {PREVIEW_LOCALES.map(l => (
              <Button
                key={l}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 rounded-none px-3 text-xs first:rounded-l-md last:rounded-r-md',
                  previewLocale === l &&
                    'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                )}
                onClick={() => setPreviewLocale(l)}
              >
                {l.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        {!canSubmit ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {t('preview.empty')}
          </div>
        ) : (
          <div className="space-y-5 rounded-lg border bg-card p-5">
            {/* Push notification */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('preview.pushLabel')}
                </p>
                {preview.truncated && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    {t('preview.truncatedBadge', { limit: PUSH_PREVIEW_LEN })}
                  </span>
                )}
              </div>
              <div className="rounded-2xl border bg-muted/40 p-3 shadow-sm">
                <div className="flex gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                    R
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold">
                        {pushTitle(selectedSportName, previewLocale)}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('preview.now')}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                      {preview.text}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* In-app channel message */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('preview.inAppLabel')}
              </p>
              <div className="rounded-lg border">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <Megaphone className="size-4 text-primary" />
                  <span className="text-sm font-medium">{selectedSportName}</span>
                </div>
                <div className="p-3">
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2">
                    <p className="mb-0.5 text-xs font-semibold text-primary">Rallia</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{trimmed}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
