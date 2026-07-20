import { getTranslations } from 'next-intl/server';
import { defaultLocale, type Locale } from '@rallia/shared-translations';

import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/og-template';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export const alt = 'Tennis & Pickleball Courts Near You';

export default async function Image({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale = defaultLocale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo.courts' });
  return renderOgImage({
    eyebrow: locale === 'fr-CA' ? 'Terrains' : 'Courts',
    title: t('ogTitle'),
    subtitle: t('ogDescription'),
  });
}
