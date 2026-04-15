import Footer from '@/components/footer';

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="flex grow w-full flex-col">{children}</main>
      <Footer />
    </>
  );
}
