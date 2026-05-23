'use client';

import { useTranslations } from 'next-intl';

import { useConsent } from './consent-provider';

/**
 * Footer link that re-opens the cookie preferences dialog. Required by
 * Quebec Law 25 — visitors must be able to change their tracking choices
 * at any time, not just on their first visit.
 */
export function CookiePreferencesTrigger({ className }: { className?: string }) {
  const t = useTranslations('cookieConsent');
  const { openPreferences } = useConsent();
  return (
    <button
      type="button"
      onClick={openPreferences}
      className={
        className ??
        'text-left text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors'
      }
    >
      {t('footerLink')}
    </button>
  );
}
