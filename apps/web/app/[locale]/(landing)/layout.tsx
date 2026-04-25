import Footer from '@/components/footer';
import { LandingHeader } from '@/components/landing-header';

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LandingHeader />
      <main className="flex grow w-full flex-col">{children}</main>
      <Footer />
    </>
  );
}
