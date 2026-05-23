import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { defaultLocale, locales, type Locale } from '@rallia/shared-translations';

import { getGuideBySlug } from '@/app/[locale]/(marketing)/guides/_content';
import { JsonLd, breadcrumbJsonLd } from '@/components/json-ld';
import { SITE_URL } from '@/lib/seo';

// Top-level public marketing paths → seo translation namespace key.
const BREADCRUMB_PATHS: Record<string, string> = {
  '/games': 'games',
  '/communities': 'communities',
  '/guides': 'guides',
  '/about': 'about',
  '/donate': 'donate',
  '/privacy': 'privacy',
  '/terms': 'terms',
  '/eula': 'eula',
  '/delete-account': 'deleteAccount',
};

function stripLocale(pathname: string): { locale: Locale | null; rest: string } {
  for (const locale of locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      const rest = pathname.slice(locale.length + 1) || '/';
      return { locale, rest };
    }
  }
  return { locale: null, rest: pathname };
}

/**
 * Renders BreadcrumbList JSON-LD for known public marketing routes.
 * Reads x-pathname header (set by proxy.ts).
 * Handles flat marketing routes and /guides/[slug] article routes.
 */
export async function BreadcrumbsJsonLd() {
  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';
  const { locale, rest } = stripLocale(pathname);

  if (!locale || rest === '/') return null;

  const tCommon = await getTranslations({ locale, namespace: 'home.header.nav' });
  const tGuides = await getTranslations({ locale, namespace: 'seo.guides' });

  // /guides/[slug] — three-level breadcrumb (falls back to Home › Guides
  // if the slug isn't found, so the trail still renders).
  const guideMatch = /^\/guides\/([^/]+)$/.exec(rest);
  if (guideMatch) {
    const slug = guideMatch[1];
    const guide = getGuideBySlug(slug);

    const baseItems = [
      { name: tCommon('home'), url: `${SITE_URL}/${locale}` },
      { name: tGuides('title'), url: `${SITE_URL}/${locale}/guides` },
    ];

    if (!guide) {
      return <JsonLd data={breadcrumbJsonLd(baseItems)} />;
    }

    const localized = guide.content[locale] ?? guide.content[defaultLocale];
    const items = [
      ...baseItems,
      { name: localized.title, url: `${SITE_URL}/${locale}/guides/${slug}` },
    ];
    return <JsonLd data={breadcrumbJsonLd(items)} />;
  }

  // Flat marketing routes
  const seoKey = BREADCRUMB_PATHS[rest];
  if (!seoKey) return null;

  const tPage = await getTranslations({ locale, namespace: `seo.${seoKey}` });
  const items = [
    { name: tCommon('home'), url: `${SITE_URL}/${locale}` },
    { name: tPage('title'), url: `${SITE_URL}/${locale}${rest}` },
  ];
  return <JsonLd data={breadcrumbJsonLd(items)} />;
}
