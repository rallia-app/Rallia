'use client';

import { useUtmCampaigns } from '@rallia/shared-hooks';
import {
  buildUtmUrl,
  UTM_MEDIUMS,
  UTM_SOURCES,
  type UtmMedium,
  type UtmSource,
} from '@rallia/shared-utils';
import { Check, Copy, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

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
  { value: 'https://rallia.app/play', label: '/play (Friends & Family)' },
  { value: 'https://rallia.app/games', label: '/games (public matches)' },
  { value: 'https://rallia.app/communities', label: '/communities' },
  { value: 'https://rallia.app/donate', label: '/donate' },
];

/**
 * Self-service URL builder for non-technical admins. Pick a destination,
 * a campaign (from DB), source/medium (from typed vocabulary), optional
 * content variant. Live-preview the URL, copy or grab a QR code.
 *
 * Inline "+ New campaign" so the operator doesn't bounce between screens
 * to add a campaign mid-flow.
 */
export function LinkBuilder() {
  const t = useTranslations('admin.analytics.links');
  const { campaigns, create } = useUtmCampaigns();

  const [destination, setDestination] = useState(DEFAULT_DESTINATIONS[0].value);
  const [campaignId, setCampaignId] = useState<string>('');
  const [source, setSource] = useState<UtmSource | ''>('');
  const [medium, setMedium] = useState<UtmMedium | ''>('');
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const selectedCampaign = campaigns.find(c => c.id === campaignId);

  const generatedUrl = useMemo(() => {
    if (!destination || !selectedCampaign || !source || !medium) return '';
    return buildUtmUrl(destination, {
      utm_source: source,
      utm_medium: medium,
      utm_campaign: selectedCampaign.slug,
      utm_content: content || undefined,
    });
  }, [destination, selectedCampaign, source, medium, content]);

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
              />
            </div>
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
        onCreate={async params => {
          const result = await create(params);
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
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (params: {
    slug: string;
    displayName: string;
    description?: string;
  }) => Promise<{ id: string | null; error: string | null }>;
}) {
  const t = useTranslations('admin.analytics.links');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from display name. Operator can paste a name like
  // "Friends & Family 2026" and we produce `friends_family_2026`.
  const slug = useMemo(() => slugify(displayName), [displayName]);

  const reset = () => {
    setDisplayName('');
    setDescription('');
    setError(null);
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (!slug || !displayName) return;
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
            <p className="text-xs text-muted-foreground m-0 mt-1">
              {t('slugPreview')} <span className="font-mono">{slug || '—'}</span>
            </p>
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
          <Button
            onClick={() => void handleSubmit()}
            disabled={!slug || !displayName || submitting}
          >
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
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}
