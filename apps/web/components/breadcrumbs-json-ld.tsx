'use client';

import { useLocale, useTranslations } from 'next-intl';

import { usePathname } from '@/i18n/navigation';

// Canonical site origin for absolute breadcrumb URLs. Mirrors SITE_URL in
// lib/seo.ts, kept local because lib/seo imports next-intl/server and so can't
// be pulled into this client component.
const SITE_URL = 'https://www.rallia.app';

// Flat public marketing paths (locale-stripped) → seo translation namespace key.
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

/**
 * Renders BreadcrumbList JSON-LD for known flat public marketing routes.
 *
 * Client component (reads usePathname) so the marketing/legal pages can be
 * statically generated — the previous server version read the `x-pathname`
 * header, which forced every page under these layouts into dynamic rendering.
 * The /guides/[slug] article route emits its own title-aware breadcrumb
 * server-side, so it's intentionally absent from the map above.
 */
export function BreadcrumbsJsonLd() {
  const pathname = usePathname(); // locale-stripped, e.g. "/about" ("/" for home)
  const locale = useLocale();
  const t = useTranslations();

  const seoKey = BREADCRUMB_PATHS[pathname];
  if (!seoKey) return null;

  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: t('home.header.nav.home'), url: `${SITE_URL}/${locale}` },
      { name: t(`seo.${seoKey}.title`), url: `${SITE_URL}/${locale}${pathname}` },
    ].map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}
