import { BreadcrumbsJsonLd } from '@/components/breadcrumbs-json-ld';
import Footer from '@/components/footer';
import { LandingHeader } from '@/components/landing-header';
import { SmartAppBanner } from '@/components/smart-app-banner';

export default function LandingLayout({ children }: { children: React.ReactNode }) {
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
