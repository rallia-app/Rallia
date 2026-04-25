import Header from '@/components/header';
import Footer from '@/components/footer';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex grow w-full max-w-6xl flex-col items-center justify-between py-12 px-8 sm:items-start mx-auto">
        {children}
      </main>
      <Footer />
    </>
  );
}
