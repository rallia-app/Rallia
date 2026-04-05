import { PlayerInterestForm } from '@/components/player-interest-form';
import { Badge } from '@/components/ui/badge';
import { Shield, Sparkles, Zap } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('playerInterest');
  return {
    title: t('title'),
  };
}

export default async function PlayPage() {
  const t = await getTranslations('playerInterest');

  const trustIndicators = [
    { key: 'secure', icon: Shield },
    { key: 'fast', icon: Zap },
    { key: 'premium', icon: Sparkles },
  ] as const;

  return (
    <div className="flex flex-col items-center w-full pb-16 relative">
      {/* Background Pattern */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--primary-200)_1px,transparent_0)] dark:bg-[radial-gradient(circle_at_1px_1px,var(--primary-900)_1px,transparent_0)] bg-[size:32px_32px] opacity-40" />
      </div>

      {/* Floating Decorative Elements */}
      <div className="absolute inset-0 -z-5 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-[10%] size-16 rounded-full bg-[var(--primary-300)] dark:bg-[var(--primary-700)] opacity-20 blur-xl animate-float" />
        <div className="absolute top-40 right-[15%] size-24 rounded-full bg-[var(--secondary-300)] dark:bg-[var(--secondary-700)] opacity-20 blur-xl animate-float-delayed" />
        <div className="absolute bottom-[30%] left-[5%] size-20 rounded-full bg-[var(--accent-300)] dark:bg-[var(--accent-700)] opacity-20 blur-xl animate-float-slow" />
      </div>

      {/* Hero + Form */}
      <section className="flex flex-col items-center gap-6 sm:gap-8 animate-fade-in hero-gradient rounded-2xl sm:rounded-3xl p-4 sm:p-8 md:p-12 shadow-luma-lg w-full relative overflow-hidden">
        <div className="absolute -top-10 -right-10 size-40 rounded-full bg-[var(--secondary-200)] dark:bg-[var(--secondary-800)] opacity-30 blur-2xl" />
        <div className="absolute -bottom-10 -left-10 size-32 rounded-full bg-[var(--primary-200)] dark:bg-[var(--primary-800)] opacity-30 blur-2xl" />

        {/* Hero Text */}
        <div className="flex flex-col items-center text-center gap-3 sm:gap-4 relative z-10">
          <Badge className="badge-interactive text-xs sm:text-sm px-3 sm:px-4 py-1 sm:py-1.5 bg-[var(--primary-500)] hover:bg-[var(--primary-600)] text-white animate-pulse-subtle">
            {t('hero.badge')}
          </Badge>
          <h1 className="text-3xl sm:text-5xl md:text-7xl font-bold mt-2 bg-gradient-to-r from-[var(--primary-700)] via-[var(--secondary-600)] to-[var(--primary-700)] bg-clip-text text-transparent dark:text-white dark:bg-none">
            {t('hero.headline')}
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl">
            {t('hero.subheadline')}
          </p>
        </div>

        {/* Form */}
        <div className="relative z-10 w-full flex justify-center">
          <PlayerInterestForm />
        </div>

        {/* Trust Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-6 relative z-10">
          {trustIndicators.map(({ key, icon: Icon }) => (
            <div key={key} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-4 text-[var(--primary-600)] dark:text-[var(--primary-400)]" />
              <span>{t(`trust.${key}`)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
