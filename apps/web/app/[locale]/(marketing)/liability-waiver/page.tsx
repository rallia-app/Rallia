import type { Metadata } from 'next';
import Markdown from 'react-markdown';
import { setRequestLocale } from 'next-intl/server';
import { defaultLocale, type Locale } from '@rallia/shared-translations';

import { liabilityWaiver } from './liability-waiver-content';

import { buildPageMetadata } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/liability-waiver', namespace: 'seo.liabilityWaiver' });
}

export default async function LiabilityWaiverPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Cross-links in the markdown are locale-less; prefix them so the reader
  // stays in their locale instead of bouncing through middleware detection.
  const content = (liabilityWaiver[locale] ?? liabilityWaiver[defaultLocale]).replaceAll(
    '](/',
    `](/${locale}/`
  );

  return (
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
      <Markdown>{content}</Markdown>
    </article>
  );
}
