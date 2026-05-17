import Footer from '@/components/footer';
import { LandingHeader } from '@/components/landing-header';
import { SmartAppBanner } from '@/components/smart-app-banner';

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SmartAppBanner />
      <LandingHeader />
      <main className="flex grow w-full flex-col">{children}</main>
      <Footer />
    </>
  );
}
