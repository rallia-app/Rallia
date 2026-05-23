import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';

import { buildPageMetadata } from '@/lib/seo';
import { EnzuzoEmbed } from '@/components/enzuzo-embed';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/terms', namespace: 'seo.terms' });
}

export default function TermsPage() {
  return (
    <div className="flex flex-col w-full pb-16">
      <EnzuzoEmbed scriptUrl="https://app.enzuzo.com/scripts/tos/b265d6f0-258f-11f1-9e9e-c357d4c9e94e" />
    </div>
  );
}
