import type { Locale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { BreadcrumbsJsonLd } from '@/components/breadcrumbs-json-ld';
import Footer from '@/components/footer';
import { LandingHeader } from '@/components/landing-header';
import { SmartAppBanner } from '@/components/smart-app-banner';

export default async function LandingLayout({
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
      <LandingHeader />
      <main className="flex grow w-full flex-col">{children}</main>
      <Footer />
    </>
  );
}
