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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useDebounce } from '@rallia/shared-hooks';
import { Eye, Mail, Moon, Save, Send, Sun, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface SportOption {
  id: string;
  display_name: string;
}

interface BroadcastHistory {
  id: string;
  subject: string;
  audience: { source?: string; count?: number } | null;
  recipients_total: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_at: string;
}

interface DraftAudience {
  source?: string;
  emails?: string[];
  filters?: {
    sportId?: string | null;
    city?: string | null;
    locale?: string | null;
    activeWithinDays?: number | null;
    onlySubscribers?: boolean;
  };
}

interface DraftItem {
  id: string;
  subject: string;
  body: string;
  cta_text: string | null;
  cta_url: string | null;
  audience: DraftAudience | null;
  created_at: string;
}

interface Feedback {
  type: 'success' | 'error';
  message: string;
}

type AudienceMode = 'list' | 'segment';
type LocaleFilter = 'any' | 'en-US' | 'fr-CA';
type ActiveFilter = 'any' | '7' | '30' | '90';

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

export function AdminEmailsView({ sports }: { sports: SportOption[] }) {
  const t = useTranslations('admin.emails');
  const locale = useLocale();

  // ---- Compose state ----
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');

  // ---- Recipients state ----
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('list');
  const [recipientEmails, setRecipientEmails] = useState('');
  // Segment filters
  const [segSport, setSegSport] = useState('any');
  const [segCity, setSegCity] = useState('');
  const [segLocale, setSegLocale] = useState<LocaleFilter>('any');
  const [segActive, setSegActive] = useState<ActiveFilter>('any');
  const [segOnlySubscribers, setSegOnlySubscribers] = useState(false);
  const [segmentCount, setSegmentCount] = useState<number | null>(null);
  const [segmentCountLoading, setSegmentCountLoading] = useState(false);
  const [segmentCountError, setSegmentCountError] = useState(false);

  // ---- Test send state ----
  const [testEmail, setTestEmail] = useState('');

  // ---- Preview state ----
  const [previewLocale, setPreviewLocale] = useState(locale === 'fr-CA' ? 'fr-CA' : 'en-US');
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');

  // ---- Async state ----
  const [isSending, setIsSending] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [history, setHistory] = useState<BroadcastHistory[]>([]);

  // ---- Drafts ----
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const hasContent = subject.trim().length > 0 && body.trim().length > 0;

  const { valid: validEmails, invalid: invalidEmails } = useMemo(
    () => parseEmailList(recipientEmails),
    [recipientEmails]
  );
  const listCount = validEmails.length;

  const effectiveCount = audienceMode === 'segment' ? (segmentCount ?? 0) : listCount;
  const canSend =
    hasContent &&
    !isSending &&
    effectiveCount > 0 &&
    !(audienceMode === 'segment' && segmentCountLoading);

  /** Current segment filters in the API's payload shape. */
  const currentSegment = useCallback(
    () => ({
      sportId: segSport === 'any' ? null : segSport,
      city: segCity.trim() || null,
      locale: segLocale === 'any' ? null : segLocale,
      activeWithinDays: segActive === 'any' ? null : Number(segActive),
      onlySubscribers: segOnlySubscribers,
    }),
    [segSport, segCity, segLocale, segActive, segOnlySubscribers]
  );

  /** The audience half of a send/draft payload (segment filters or email list). */
  const buildAudiencePayload = useCallback(
    () =>
      audienceMode === 'segment'
        ? { audienceMode: 'segment' as const, segment: currentSegment() }
        : { audienceMode: 'list' as const, emails: validEmails },
    [audienceMode, currentSegment, validEmails]
  );

  // ---- Live segment recipient count (debounced) ----
  const segmentQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (segSport !== 'any') params.set('sportId', segSport);
    if (segCity.trim()) params.set('city', segCity.trim());
    if (segLocale !== 'any') params.set('locale', segLocale);
    if (segActive !== 'any') params.set('activeWithinDays', segActive);
    if (segOnlySubscribers) params.set('onlySubscribers', 'true');
    return params.toString();
  }, [segSport, segCity, segLocale, segActive, segOnlySubscribers]);

  const debouncedQuery = useDebounce(segmentQuery, 400);

  useEffect(() => {
    if (audienceMode !== 'segment') return;
    let cancelled = false;
    setSegmentCountLoading(true);
    setSegmentCountError(false);
    fetch(`/api/admin/broadcasts/recipients?${debouncedQuery}`)
      .then(async res => {
        const data = (await res.json()) as { count?: number };
        if (cancelled) return;
        if (!res.ok || typeof data.count !== 'number') {
          setSegmentCountError(true);
          setSegmentCount(null);
        } else {
          setSegmentCount(data.count);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSegmentCountError(true);
        setSegmentCount(null);
      })
      .finally(() => {
        if (!cancelled) setSegmentCountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audienceMode, debouncedQuery]);

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

  const loadDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/broadcasts?status=draft');
      const data = (await res.json()) as { drafts?: DraftItem[] };
      if (Array.isArray(data.drafts)) setDrafts(data.drafts);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    void loadDrafts();
  }, [loadHistory, loadDrafts]);

  // ---- Actions ----
  const resetComposer = () => {
    setSubject('');
    setBody('');
    setCtaText('');
    setCtaUrl('');
    setRecipientEmails('');
    setAudienceMode('list');
    setSegSport('any');
    setSegCity('');
    setSegLocale('any');
    setSegActive('any');
    setSegOnlySubscribers(false);
    setDraftId(null);
  };
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
          testEmail: testEmail.trim() || undefined,
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
          broadcastId: draftId ?? undefined,
          ...buildAudiencePayload(),
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
        resetComposer();
        void loadHistory();
        void loadDrafts();
      } else {
        setFeedback({ type: 'error', message: data.error ?? t('toast.sendFailed') });
      }
    } catch {
      setFeedback({ type: 'error', message: t('toast.sendFailed') });
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          subject,
          body,
          ctaText,
          ctaUrl,
          broadcastId: draftId ?? undefined,
          ...buildAudiencePayload(),
        }),
      });
      const data = (await res.json()) as { success?: boolean; draftId?: string; error?: string };
      if (res.ok && data.success) {
        if (data.draftId) setDraftId(data.draftId);
        setFeedback({ type: 'success', message: t('toast.draftSaved') });
        void loadDrafts();
      } else {
        setFeedback({ type: 'error', message: data.error ?? t('toast.draftFailed') });
      }
    } catch {
      setFeedback({ type: 'error', message: t('toast.draftFailed') });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleLoadDraft = (d: DraftItem) => {
    setSubject(d.subject ?? '');
    setBody(d.body ?? '');
    setCtaText(d.cta_text ?? '');
    setCtaUrl(d.cta_url ?? '');
    const a = d.audience;
    if (a?.source === 'segment') {
      const f = a.filters ?? {};
      setAudienceMode('segment');
      setSegSport(f.sportId ?? 'any');
      setSegCity(f.city ?? '');
      setSegLocale((f.locale as LocaleFilter) ?? 'any');
      setSegActive(f.activeWithinDays ? (String(f.activeWithinDays) as ActiveFilter) : 'any');
      setSegOnlySubscribers(!!f.onlySubscribers);
      setRecipientEmails('');
    } else {
      setAudienceMode('list');
      setRecipientEmails((a?.emails ?? []).join(', '));
    }
    setDraftId(d.id);
    setFeedback(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteDraft = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/broadcasts?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (id === draftId) resetComposer();
        setFeedback({ type: 'success', message: t('toast.draftDeleted') });
        void loadDrafts();
      }
    } catch {
      /* non-fatal */
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

  const audienceLabel = (audience: BroadcastHistory['audience']): string =>
    audience?.source === 'segment' ? t('history.audienceSegment') : t('history.audienceList');

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
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
              <Tabs
                value={audienceMode}
                onValueChange={value => setAudienceMode(value as AudienceMode)}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="list">{t('recipients.modeList')}</TabsTrigger>
                  <TabsTrigger value="segment">{t('recipients.modeSegment')}</TabsTrigger>
                </TabsList>

                {/* Paste list */}
                <TabsContent value="list" className="space-y-4 pt-4">
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
                      {t('recipients.count', { count: listCount })}
                    </span>
                    {invalidEmails.length > 0 && (
                      <span className="text-sm text-amber-600 dark:text-amber-400">
                        {t('recipients.invalid', { count: invalidEmails.length })}
                      </span>
                    )}
                  </div>
                </TabsContent>

                {/* Segment builder */}
                <TabsContent value="segment" className="space-y-4 pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t('recipients.segment.sportLabel')}</Label>
                      <Select value={segSport} onValueChange={setSegSport}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">{t('recipients.segment.sportAny')}</SelectItem>
                          {sports.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.display_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('recipients.segment.localeLabel')}</Label>
                      <Select
                        value={segLocale}
                        onValueChange={value => setSegLocale(value as LocaleFilter)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">{t('recipients.segment.localeAny')}</SelectItem>
                          <SelectItem value="en-US">English</SelectItem>
                          <SelectItem value="fr-CA">Français</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="segment-city">{t('recipients.segment.cityLabel')}</Label>
                      <Input
                        id="segment-city"
                        value={segCity}
                        onChange={e => setSegCity(e.target.value)}
                        placeholder={t('recipients.segment.cityPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('recipients.segment.activeLabel')}</Label>
                      <Select
                        value={segActive}
                        onValueChange={value => setSegActive(value as ActiveFilter)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">{t('recipients.segment.activeAny')}</SelectItem>
                          <SelectItem value="7">{t('recipients.segment.active7')}</SelectItem>
                          <SelectItem value="30">{t('recipients.segment.active30')}</SelectItem>
                          <SelectItem value="90">{t('recipients.segment.active90')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={segOnlySubscribers}
                      onCheckedChange={value => setSegOnlySubscribers(value === true)}
                    />
                    {t('recipients.segment.onlySubscribers')}
                  </label>

                  <div className="flex items-center gap-2 pt-1 text-sm font-medium">
                    <Users className="size-4 text-muted-foreground" />
                    {segmentCountLoading ? (
                      <span className="text-muted-foreground">
                        {t('recipients.segment.counting')}
                      </span>
                    ) : segmentCountError ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {t('recipients.segment.countError')}
                      </span>
                    ) : (
                      <span>{t('recipients.segment.count', { count: segmentCount ?? 0 })}</span>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="space-y-4 rounded-lg border bg-card p-4">
            {draftId && (
              <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <span className="font-medium">{t('drafts.editing')}</span>
                <button
                  type="button"
                  onClick={resetComposer}
                  className="ml-auto text-muted-foreground underline hover:text-foreground"
                >
                  {t('drafts.new')}
                </button>
              </div>
            )}

            {/* Test send: address + button inline */}
            <div className="space-y-1.5">
              <Label htmlFor="broadcast-test-email" className="text-xs text-muted-foreground">
                {t('actions.testToLabel')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="broadcast-test-email"
                  type="email"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  placeholder={t('actions.testToPlaceholder')}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void handleSendTest()}
                  disabled={!hasContent || isTesting}
                >
                  <Mail className="mr-2 size-4" />
                  {isTesting ? t('actions.sending') : t('actions.sendTest')}
                </Button>
              </div>
            </div>

            {/* Primary actions */}
            <div className="flex items-center gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => void handleSaveDraft()}
                disabled={isSavingDraft || (!subject.trim() && !body.trim())}
              >
                <Save className="mr-2 size-4" />
                {isSavingDraft ? t('actions.sending') : t('actions.saveDraft')}
              </Button>
              <Button className="ml-auto" onClick={() => setConfirmOpen(true)} disabled={!canSend}>
                <Send className="mr-2 size-4" />
                {isSending ? t('actions.sending') : t('actions.send')}
              </Button>
            </div>
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
        <div className="space-y-3 lg:sticky lg:top-6">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Eye className="size-4 text-muted-foreground" />
              {t('preview.heading')}
            </h3>
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

      {/* Sent broadcasts + drafts */}
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="history">
            <TabsList>
              <TabsTrigger value="history">{t('history.heading')}</TabsTrigger>
              <TabsTrigger value="drafts" className="gap-1.5">
                {t('drafts.heading')}
                {drafts.length > 0 && (
                  <Badge variant="secondary" className="px-1.5">
                    {drafts.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="history" className="pt-4">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">{t('history.subject')}</th>
                        <th className="py-2 pr-4 font-medium">{t('history.audience')}</th>
                        <th className="py-2 pr-4 font-medium">{t('history.recipients')}</th>
                        <th className="py-2 pr-4 font-medium">{t('history.sent')}</th>
                        <th className="py-2 pr-4 font-medium">{t('history.failed')}</th>
                        <th className="py-2 pr-4 font-medium">{t('history.status')}</th>
                        <th className="py-2 pr-4 font-medium">{t('history.date')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(b => (
                        <tr key={b.id} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="py-2 pr-4 max-w-[280px] truncate">
                            <Link
                              href={`/admin/emails/${b.id}`}
                              className="font-medium hover:underline"
                            >
                              {b.subject}
                            </Link>
                          </td>
                          <td className="py-2 pr-4">
                            <Badge variant="outline">{audienceLabel(b.audience)}</Badge>
                          </td>
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
            </TabsContent>

            <TabsContent value="drafts" className="pt-4">
              {drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('drafts.empty')}</p>
              ) : (
                <ul className="divide-y">
                  {drafts.map(d => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleLoadDraft(d)}
                        className="flex-1 truncate text-left text-sm font-medium hover:underline"
                      >
                        {d.subject?.trim() || t('drafts.untitled')}
                      </button>
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {new Date(d.created_at).toLocaleDateString(locale)}
                      </span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleLoadDraft(d)}>
                          {t('drafts.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 dark:text-red-400"
                          onClick={() => void handleDeleteDraft(d.id)}
                        >
                          {t('drafts.delete')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirm.description', { count: effectiveCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSend()}>
              {t('confirm.confirm', { count: effectiveCount })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
