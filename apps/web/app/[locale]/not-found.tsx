import { ArrowRight, Home } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import Footer from '@/components/footer';
import { LandingHeader } from '@/components/landing-header';

export default async function NotFound() {
  const t = await getTranslations('notFoundPage');

  const exploreLinks = [
    { href: '/games', key: 'games' },
    { href: '/courts', key: 'courts' },
    { href: '/communities', key: 'communities' },
    { href: '/guides', key: 'guides' },
  ] as const;

  return (
    <>
      <LandingHeader />
      <main className="flex grow w-full flex-col">
        <section className="relative flex items-center justify-center w-full min-h-[100svh] overflow-hidden bg-[var(--primary-950)] dark:bg-[#0b1a18]">
          <div className="relative z-10 flex flex-col items-center text-center gap-8 px-8 pt-36 pb-24 max-w-3xl mx-auto">
            <p className="text-7xl md:text-9xl font-bold text-white/20">404</p>
            <h1 className="text-4xl md:text-6xl font-bold text-white -mt-4">{t('title')}</h1>
            <p className="text-lg text-white/60 max-w-xl">{t('description')}</p>

            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white font-semibold transition-colors"
            >
              <Home className="size-4" />
              {t('backHome')}
            </Link>

            <div className="flex flex-col items-center gap-4 mt-8 w-full">
              <p className="text-sm uppercase tracking-wider text-white/40">
                {t('exploreHeading')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl">
                {exploreLinks.map(link => (
                  <Link
                    key={link.key}
                    href={link.href}
                    className="group flex items-center justify-between gap-2 px-5 py-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white transition-all"
                  >
                    <span className="font-medium">{t(link.key)}</span>
                    <ArrowRight className="size-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
