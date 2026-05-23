import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { defaultLocale, type Locale } from '@rallia/shared-translations';

import { getAllGuides } from './_content';

import { JsonLd } from '@/components/json-ld';
import { buildPageMetadata, SITE_URL } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/guides', namespace: 'seo.guides' });
}

export default async function GuidesPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo.guides' });
  const guides = getAllGuides();

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: guides.map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/${locale}/guides/${g.meta.slug}`,
      name: (g.content[locale] ?? g.content[defaultLocale]).title,
    })),
  };

  return (
    <div className="flex flex-col w-full gap-12 py-12">
      <JsonLd data={itemList} />
      <div className="text-center max-w-2xl mx-auto px-4">
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t('description')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto px-4">
        {guides.map(g => {
          const content = g.content[locale] ?? g.content[defaultLocale];
          const { image } = g.meta;
          return (
            <Link
              key={g.meta.slug}
              href={`/${locale}/guides/${g.meta.slug}`}
              className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary hover:shadow-md transition-all"
            >
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                <Image
                  src={image.src}
                  alt={content.imageAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="flex flex-col gap-3 p-6">
                <h2 className="text-xl font-semibold text-card-foreground group-hover:text-primary transition-colors">
                  {content.title}
                </h2>
                <p className="text-sm text-muted-foreground line-clamp-3">{content.description}</p>
                <div className="flex flex-wrap gap-2 mt-auto pt-2">
                  {g.meta.sports.map(sport => (
                    <span
                      key={sport}
                      className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize"
                    >
                      {sport}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
