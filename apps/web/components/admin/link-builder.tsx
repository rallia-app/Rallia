'use client';

import type { UtmCampaign } from '@rallia/shared-hooks';
import {
  buildUtmUrl,
  UTM_MEDIUMS,
  UTM_SOURCES,
  type UtmMedium,
  type UtmSource,
} from '@rallia/shared-utils';
import { Check, Copy, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const DEFAULT_DESTINATIONS = [
  { value: 'https://rallia.app/', label: 'Home' },
  { value: 'https://rallia.app/games', label: '/games (public matches)' },
  { value: 'https://rallia.app/communities', label: '/communities' },
  { value: 'https://rallia.app/donate', label: '/donate' },
];

const SLUG_REGEX = /^[a-z0-9_]+$/;

function isRalliaHost(host: string): boolean {
  return host === 'rallia.app' || host.endsWith('.rallia.app');
}

type DestinationValidation = { ok: true } | { ok: false; reason: 'invalid' | 'restricted' };

function validateDestination(url: string): DestinationValidation {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, reason: 'invalid' };
    }
    if (!isRalliaHost(parsed.host)) {
      return { ok: false, reason: 'restricted' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

interface LinkBuilderProps {
  campaigns: UtmCampaign[];
  onCreate: (params: {
    slug: string;
    displayName: string;
    description?: string;
  }) => Promise<{ id: string | null; error: string | null }>;
}

/**
 * Self-service URL builder for non-technical admins. Pick a destination,
 * a campaign (from DB), source/medium (from typed vocabulary), optional
 * content variant. Live-preview the URL, copy or grab a QR code.
 *
 * Inline "+ New campaign" so the operator doesn't bounce between screens
 * to add a campaign mid-flow. Campaigns are owned by the parent so a
 * create here is visible in the catalog list without a page refresh.
 */
export function LinkBuilder({ campaigns, onCreate }: LinkBuilderProps) {
  const t = useTranslations('admin.analytics.links');

  const [destination, setDestination] = useState(DEFAULT_DESTINATIONS[0].value);
  const [campaignId, setCampaignId] = useState<string>('');
  const [source, setSource] = useState<UtmSource | ''>('');
  const [medium, setMedium] = useState<UtmMedium | ''>('');
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const selectedCampaign = campaigns.find(c => c.id === campaignId);

  const destinationValidation = useMemo(() => validateDestination(destination), [destination]);
  const destinationError = !destinationValidation.ok
    ? destinationValidation.reason === 'restricted'
      ? t('restrictedDestination')
      : t('invalidDestination')
    : null;

  const existingSlugs = useMemo(() => new Set(campaigns.map(c => c.slug)), [campaigns]);

  const generatedUrl = useMemo(() => {
    if (!destinationValidation.ok || !selectedCampaign || !source || !medium) return '';
    return buildUtmUrl(destination, {
      utm_source: source,
      utm_medium: medium,
      utm_campaign: selectedCampaign.slug,
      utm_content: content || undefined,
    });
  }, [destination, destinationValidation.ok, selectedCampaign, source, medium, content]);

  const handleCopy = async () => {
    if (!generatedUrl) return;
    await navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('builderTitle')}</CardTitle>
        <p className="text-xs text-muted-foreground m-0 mt-1">{t('builderDescription')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Form */}
        <div className="flex flex-col gap-4">
          <Field label={t('destination')}>
            <div className="flex gap-2">
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEFAULT_DESTINATIONS.map(d => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={destination}
                onChange={e => setDestination(e.target.value)}
                placeholder="https://rallia.app/..."
                className="flex-1"
                aria-invalid={destinationError ? true : undefined}
              />
            </div>
            {destinationError && (
              <p className="text-xs text-destructive m-0 mt-1">{destinationError}</p>
            )}
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Field label={t('campaign')} className="sm:col-span-2">
              <div className="flex gap-2">
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t('campaignPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.displayName}{' '}
                        <span className="text-muted-foreground text-xs">({c.slug})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCreateOpen(true)}
                  title={t('newCampaign')}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </Field>

            <Field label={t('source')}>
              <Select value={source} onValueChange={v => setSource(v as UtmSource)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('sourcePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {UTM_SOURCES.map(s => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={t('medium')}>
              <Select value={medium} onValueChange={v => setMedium(v as UtmMedium)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('mediumPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {UTM_MEDIUMS.map(m => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={t('content')} optional>
            <Input
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={t('contentPlaceholder')}
            />
          </Field>
        </div>

        <Field label={t('generatedUrl')} className="border-t pt-4">
          <div className="flex gap-2">
            <Input
              value={generatedUrl}
              readOnly
              placeholder={t('fillFormPrompt')}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!generatedUrl}
              variant={copied ? 'default' : 'outline'}
              size="icon"
              title={t('copy')}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </Field>
      </CardContent>

      <NewCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingSlugs={existingSlugs}
        onCreate={async params => {
          const result = await onCreate(params);
          if (result.id) setCampaignId(result.id);
          return result;
        }}
      />
    </Card>
  );
}

function Field({
  label,
  optional,
  className,
  children,
}: {
  label: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5${className ? ` ${className}` : ''}`}>
      <Label className="text-xs">
        {label}
        {optional && <span className="text-muted-foreground ml-1">(optional)</span>}
      </Label>
      {children}
    </div>
  );
}

function NewCampaignDialog({
  open,
  onOpenChange,
  existingSlugs,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingSlugs: Set<string>;
  onCreate: (params: {
    slug: string;
    displayName: string;
    description?: string;
  }) => Promise<{ id: string | null; error: string | null }>;
}) {
  const t = useTranslations('admin.analytics.links');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from the display name until the operator edits it.
  // Once touched, it stays in sync with whatever the operator typed.
  const derivedSlug = useMemo(() => slugify(displayName), [displayName]);
  useEffect(() => {
    if (!slugTouched) setSlug(derivedSlug);
  }, [derivedSlug, slugTouched]);

  const slugFormatValid = slug !== '' && SLUG_REGEX.test(slug);
  const slugTaken = slug !== '' && existingSlugs.has(slug);
  const slugInlineError =
    slug !== '' && !slugFormatValid ? t('slugInvalid') : slugTaken ? t('slugTaken') : null;

  const canSubmit = !!displayName && slugFormatValid && !slugTaken && !submitting;

  const reset = () => {
    setDisplayName('');
    setDescription('');
    setSlug('');
    setSlugTouched(false);
    setError(null);
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result = await onCreate({ slug, displayName, description: description || undefined });
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newCampaignTitle')}</DialogTitle>
          <DialogDescription>{t('newCampaignDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label={t('campaignName')}>
            <Input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Friends & Family 2026"
            />
          </Field>
          <Field label={t('slugLabel')}>
            <Input
              value={slug}
              onChange={e => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="friends_family_2026"
              className="font-mono text-xs"
              aria-invalid={slugInlineError ? true : undefined}
            />
            <p className="text-xs text-muted-foreground m-0 mt-1">{t('slugHint')}</p>
            {slugInlineError && (
              <p className="text-xs text-destructive m-0 mt-1">{slugInlineError}</p>
            )}
          </Field>
          <Field label={t('campaignDescriptionLabel')} optional>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('campaignDescriptionPlaceholder')}
              rows={2}
            />
          </Field>
          {error && <p className="text-xs text-destructive m-0">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? t('creating') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}
