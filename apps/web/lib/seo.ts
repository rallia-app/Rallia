import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { defaultLocale, locales, type Locale } from '@rallia/shared-translations';

export const SITE_URL = 'https://rallia.app';
export const SITE_NAME = 'Rallia';
export const TWITTER_HANDLE = '@rallia';

/**
 * Build locale-aware canonical + hreflang alternates for a path.
 *
 * `path` is the route AFTER the locale segment, with leading slash —
 * e.g. '', '/games', '/communities'. Pass '' (or '/') for the home page.
 */
export function buildAlternates(
  path: string,
  currentLocale: Locale
): NonNullable<Metadata['alternates']> {
  const normalized = path === '/' ? '' : path;
  const languages: Record<string, string> = {};

  for (const locale of locales) {
    languages[locale] = `${SITE_URL}/${locale}${normalized}`;
  }
  languages['x-default'] = `${SITE_URL}/${defaultLocale}${normalized}`;

  return {
    canonical: `${SITE_URL}/${currentLocale}${normalized}`,
    languages,
  };
}

/** OG locale format (en_US, fr_CA) — schema differs from BCP-47. */
export function ogLocale(locale: Locale): string {
  return locale.replace('-', '_');
}

export function ogAlternateLocales(currentLocale: Locale): string[] {
  return locales.filter(l => l !== currentLocale).map(ogLocale);
}

/**
 * Build per-page Metadata from a `seo.<namespace>` translation key set.
 * The namespace must define `title`, `description`, `ogTitle`, `ogDescription`.
 */
export async function buildPageMetadata({
  locale,
  path,
  namespace,
  noindex = false,
}: {
  locale: Locale;
  path: string;
  namespace: string;
  noindex?: boolean;
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace });
  const url = `${SITE_URL}/${locale}${path === '/' ? '' : path}`;
  const ogTitle = t('ogTitle');
  const ogDescription = t('ogDescription');

  return {
    title: t('title'),
    description: t('description'),
    alternates: buildAlternates(path, locale),
    openGraph: {
      type: 'website',
      url,
      title: ogTitle,
      description: ogDescription,
      siteName: SITE_NAME,
      locale: ogLocale(locale),
      alternateLocale: ogAlternateLocales(locale),
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
      creator: TWITTER_HANDLE,
      site: TWITTER_HANDLE,
    },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  };
}
