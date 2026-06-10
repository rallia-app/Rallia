import type { Locale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { BreadcrumbsJsonLd } from '@/components/breadcrumbs-json-ld';
import Header from '@/components/header';
import Footer from '@/components/footer';
import { SmartAppBanner } from '@/components/smart-app-banner';

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  // Prime the locale so the shared Footer (and these pages) render statically.
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BreadcrumbsJsonLd />
      <SmartAppBanner />
      <Header />
      <main className="flex grow w-full max-w-6xl flex-col items-center justify-between py-12 px-8 sm:items-start mx-auto">
        {children}
      </main>
      <Footer />
    </>
  );
}
