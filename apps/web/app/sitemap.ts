import type { MetadataRoute } from 'next';
import { locales } from '@rallia/shared-translations';

import { getAllGuideSlugs } from '@/app/[locale]/(marketing)/guides/_content';
import { SITE_URL } from '@/lib/seo';

type ChangeFreq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

const PUBLIC_PATHS: ReadonlyArray<{
  path: string;
  changeFrequency: ChangeFreq;
  priority: number;
}> = [
  { path: '', changeFrequency: 'weekly', priority: 1.0 },
  { path: '/games', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/communities', changeFrequency: 'daily', priority: 0.8 },
  { path: '/guides', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/donate', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/eula', changeFrequency: 'yearly', priority: 0.2 },
];

function alternatesFor(path: string) {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[locale] = `${SITE_URL}/${locale}${path}`;
  }
  return { languages };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const { path, changeFrequency, priority } of PUBLIC_PATHS) {
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        changeFrequency,
        priority,
        alternates: alternatesFor(path),
      });
    }
  }

  // Individual guide articles
  for (const slug of getAllGuideSlugs()) {
    const path = `/guides/${slug}`;
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        changeFrequency: 'monthly',
        priority: 0.7,
        alternates: alternatesFor(path),
      });
    }
  }

  return entries;
}
