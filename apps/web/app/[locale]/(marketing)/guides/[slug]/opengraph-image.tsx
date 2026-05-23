import { defaultLocale, type Locale } from '@rallia/shared-translations';

import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/og-template';

import { getGuideBySlug } from '../_content';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Rallia Guide';

export default async function Image({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale = defaultLocale, slug } = await params;
  const guide = getGuideBySlug(slug);

  // Defensive fallback — Next.js usually 404s the page first, but the OG
  // endpoint is fetched separately by social crawlers.
  if (!guide) {
    return renderOgImage({
      eyebrow: 'Guide',
      title: 'Rallia Guide',
    });
  }

  const localized = guide.content[locale] ?? guide.content[defaultLocale];

  return renderOgImage({
    eyebrow: 'Guide',
    title: localized.ogTitle ?? localized.title,
    subtitle: localized.ogDescription ?? localized.description,
  });
}
