import Footer from '@/components/footer';
import { LandingHeader } from '@/components/landing-header';
import { LaunchCountdownBanner } from '@/components/launch-countdown-banner';

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LaunchCountdownBanner />
      <LandingHeader />
      <main className="flex grow w-full flex-col">{children}</main>
      <Footer />
    </>
  );
}
