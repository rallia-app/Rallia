import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { defaultLocale, locales, type Locale } from '@rallia/shared-translations';

import { getAllGuideSlugs, getGuideBySlug } from '../_content';

import { JsonLd, articleJsonLd, breadcrumbJsonLd } from '@/components/json-ld';
import {
  buildAlternates,
  ogAlternateLocales,
  ogLocale,
  SITE_NAME,
  SITE_URL,
  TWITTER_HANDLE,
} from '@/lib/seo';

type Props = {
  params: Promise<{ locale: Locale; slug: string }>;
};

export function generateStaticParams() {
  const slugs = getAllGuideSlugs();
  const params: Array<{ locale: string; slug: string }> = [];
  for (const locale of locales) {
    for (const slug of slugs) {
      params.push({ locale, slug });
    }
  }
  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const guide = getGuideBySlug(slug);
  if (!guide) return { title: 'Guide not found' };

  const content = guide.content[locale] ?? guide.content[defaultLocale];
  const path = `/guides/${slug}`;
  const url = `${SITE_URL}/${locale}${path}`;

  // Note: og:image / twitter:image are populated automatically by the colocated
  // `opengraph-image.tsx` file (Next.js metadata file convention), so we don't
  // pass explicit `images` here — that would override the dynamic 1200×630
  // branded card with the raw hero JPG.

  return {
    title: content.title,
    description: content.description,
    alternates: buildAlternates(path, locale),
    openGraph: {
      type: 'article',
      url,
      title: content.ogTitle ?? content.title,
      description: content.ogDescription ?? content.description,
      siteName: SITE_NAME,
      locale: ogLocale(locale),
      alternateLocale: ogAlternateLocales(locale),
      publishedTime: guide.meta.publishedAt,
      ...(guide.meta.updatedAt && { modifiedTime: guide.meta.updatedAt }),
    },
    twitter: {
      card: 'summary_large_image',
      title: content.ogTitle ?? content.title,
      description: content.ogDescription ?? content.description,
      creator: TWITTER_HANDLE,
      site: TWITTER_HANDLE,
    },
  };
}

export default async function GuidePage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const guide = getGuideBySlug(slug);
  if (!guide) notFound();

  const content = guide.content[locale] ?? guide.content[defaultLocale];
  const url = `${SITE_URL}/${locale}/guides/${slug}`;
  const { image } = guide.meta;

  // Home › Guides › Article. Rendered here (not in the shared client
  // BreadcrumbsJsonLd) so the article title can be included server-side.
  const tNav = await getTranslations({ locale, namespace: 'home.header.nav' });
  const tGuides = await getTranslations({ locale, namespace: 'seo.guides' });
  const breadcrumb = breadcrumbJsonLd([
    { name: tNav('home'), url: `${SITE_URL}/${locale}` },
    { name: tGuides('title'), url: `${SITE_URL}/${locale}/guides` },
    { name: content.title, url },
  ]);

  return (
    <>
      <JsonLd data={breadcrumb} />
      <JsonLd
        data={articleJsonLd({
          url,
          headline: content.title,
          description: content.description,
          datePublished: guide.meta.publishedAt,
          dateModified: guide.meta.updatedAt,
          inLanguage: locale,
          image: `${SITE_URL}${image.src}`,
        })}
      />
      <article
        className={[
          'w-full max-w-3xl mx-auto py-12 px-4',
          // Base typography
          'prose prose-neutral dark:prose-invert',
          // Headings
          'prose-headings:font-bold prose-h1:text-4xl prose-h2:text-2xl prose-h3:text-xl',
          'prose-h1:mb-4 prose-h2:mt-12 prose-h2:mb-4 prose-h3:mt-8 prose-h3:mb-2',
          // Body rhythm
          'prose-p:leading-relaxed prose-ul:my-4 prose-li:my-1',
          // Inline links — readable in both modes
          'prose-a:text-primary prose-a:font-medium prose-a:no-underline hover:prose-a:underline prose-a:underline-offset-2',
        ].join(' ')}
      >
        <h1>{content.heading}</h1>
        <figure className="!my-8 !mx-0">
          <Image
            src={image.src}
            alt={content.imageAlt}
            width={image.width}
            height={image.height}
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="!my-0 rounded-xl w-full h-auto"
          />
          {image.credit && (
            <figcaption className="text-xs !mt-2 text-right">
              <a
                href={image.credit.url}
                target="_blank"
                rel="noopener noreferrer"
                className="!text-muted-foreground !font-normal hover:!text-foreground hover:!underline underline-offset-2"
              >
                {image.credit.name
                  ? `Photo: ${image.credit.name} / Unsplash`
                  : 'Photo via Unsplash'}
              </a>
            </figcaption>
          )}
        </figure>
        <p className="text-lg text-muted-foreground !mt-0 !mb-8 font-medium">
          {content.leadAnswer}
        </p>
        {content.body}
      </article>
    </>
  );
}
