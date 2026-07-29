import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';

import EraseDataClient from '@/components/EraseDataClient';
import type { FunnelLocale } from '@/components/FunnelPage';
import enUS from '@/messages/en-US.json';
import frCA from '@/messages/fr-CA.json';

const MESSAGES: Record<FunnelLocale, typeof enUS> = {
  'en-US': enUS,
  'fr-CA': frCA as typeof enUS,
};

export function buildEraseMetadata(locale: FunnelLocale): Metadata {
  return {
    title: MESSAGES[locale].eraseData.title,
    robots: { index: false, follow: false },
  };
}

/**
 * Unlike the funnel, this page never geo-redirects: it is linked from an email
 * or from a screen the visitor already read in one language, and bouncing them
 * into the other one mid-request would be hostile.
 */
export function ErasePage({ locale }: { locale: FunnelLocale }) {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Toronto">
      <EraseDataClient />
    </NextIntlClientProvider>
  );
}
