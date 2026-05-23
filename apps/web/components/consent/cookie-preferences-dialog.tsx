'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

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
import { Switch } from '@/components/ui/switch';
import { Link } from '@/i18n/navigation';

import { useConsent } from './consent-provider';

export function CookiePreferencesDialog() {
  const t = useTranslations('cookieConsent');
  const { consent, preferencesOpen, setPreferencesOpen, save, acceptAll, rejectAll } = useConsent();
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  // Sync local toggles to current saved consent whenever the dialog opens.
  useEffect(() => {
    if (!preferencesOpen) return;
    setAnalytics(consent?.analytics ?? false);
    setMarketing(consent?.marketing ?? false);
  }, [preferencesOpen, consent]);

  return (
    <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('preferencesTitle')}</DialogTitle>
          <DialogDescription>
            {t('preferencesIntro')}{' '}
            <Link
              href="/privacy"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => setPreferencesOpen(false)}
            >
              {t('learnMore')}
            </Link>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <CategoryRow
            id="necessary"
            title={t('categories.necessary.title')}
            description={t('categories.necessary.description')}
            checked={true}
            disabled
          />
          <CategoryRow
            id="analytics"
            title={t('categories.analytics.title')}
            description={t('categories.analytics.description')}
            checked={analytics}
            onCheckedChange={setAnalytics}
          />
          <CategoryRow
            id="marketing"
            title={t('categories.marketing.title')}
            description={t('categories.marketing.description')}
            checked={marketing}
            onCheckedChange={setMarketing}
          />
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={rejectAll}>
              {t('rejectAll')}
            </Button>
            <Button variant="outline" size="sm" onClick={acceptAll}>
              {t('acceptAll')}
            </Button>
          </div>
          <Button size="sm" onClick={() => save({ analytics, marketing })}>
            {t('savePreferences')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CategoryRowProps {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (value: boolean) => void;
}

function CategoryRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: CategoryRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={title}
      />
    </div>
  );
}
