import type { MetadataRoute } from 'next';
import { locales } from '@rallia/shared-translations';

import { getAllGuides } from '@/app/[locale]/(marketing)/guides/_content';
import { SITE_URL } from '@/lib/seo';
import { createServiceRoleClient } from '@/lib/supabase/server';

type ChangeFreq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

const FACILITY_PAGE_SIZE = 1000;
// Each facility emits one URL per locale, and a sitemap tops out at 50k URLs.
const MAX_FACILITY_PAGES = Math.floor(50_000 / locales.length / FACILITY_PAGE_SIZE);

const PUBLIC_PATHS: ReadonlyArray<{
  path: string;
  changeFrequency: ChangeFreq;
  priority: number;
}> = [
  { path: '', changeFrequency: 'weekly', priority: 1.0 },
  { path: '/play', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/events', changeFrequency: 'daily', priority: 0.8 },
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

/** Facility detail pages (/play/courts/[slug]) — sourced from the directory
 * itself; a failed query degrades to the static entries rather than a 500. */
async function getFacilityEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const supabase = createServiceRoleClient();

    // Paged: an unbounded select silently stops at PostgREST's max-rows (1000
    // by default), which would drop facilities off the sitemap with no error.
    // Advancing by rows actually returned keeps this correct whatever the cap.
    const facilities: { slug: string; updated_at: string }[] = [];
    for (let page = 0; page < MAX_FACILITY_PAGES; page++) {
      const { data, error } = await supabase
        .from('facility')
        .select('slug, updated_at')
        .eq('is_active', true)
        .is('archived_at', null)
        .order('slug')
        .range(facilities.length, facilities.length + FACILITY_PAGE_SIZE - 1);
      if (error || !data) break;
      facilities.push(...data);
      if (data.length === 0) break;
    }
    if (facilities.length === 0) return [];

    const entries: MetadataRoute.Sitemap = [];
    for (const facility of facilities) {
      const path = `/play/courts/${facility.slug}`;
      for (const locale of locales) {
        entries.push({
          url: `${SITE_URL}/${locale}${path}`,
          lastModified: facility.updated_at,
          changeFrequency: 'daily',
          priority: 0.6,
          alternates: alternatesFor(path),
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
  for (const guide of getAllGuides()) {
    const path = `/guides/${guide.meta.slug}`;
    const imageUrl = `${SITE_URL}${guide.meta.image.src}`;
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        changeFrequency: 'monthly',
        priority: 0.7,
        alternates: alternatesFor(path),
        images: [imageUrl],
      });
    }
  }

  entries.push(...(await getFacilityEntries()));

  return entries;
}
