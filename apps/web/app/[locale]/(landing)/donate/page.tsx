import { Badge } from '@/components/ui/badge';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import DonationPageClient from './DonationPageClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donate');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

interface Props {
  searchParams: Promise<{ payment_intent?: string }>;
}

export default async function DonatePage({ searchParams }: Props) {
  const t = await getTranslations('donate');
  const params = await searchParams;
  const defaultCompleted = !!params.payment_intent;

  return (
    <div className="flex flex-col items-center w-full gap-12 pb-24 relative min-h-screen pt-32">
      {/* Dot-grid background */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--primary-200)_1px,transparent_0)] dark:bg-[radial-gradient(circle_at_1px_1px,var(--primary-900)_1px,transparent_0)] bg-[size:32px_32px] opacity-40" />
      </div>

      {/* Hero */}
      <section className="flex flex-col items-center text-center gap-5 px-6 max-w-3xl w-full">
        <Badge className="bg-[var(--secondary-500)] hover:bg-[var(--secondary-500)] text-white px-4 py-1.5 text-sm">
          {t('hero.badge')}
        </Badge>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground">
          {t('hero.headline')}
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-xl">{t('hero.subheadline')}</p>
      </section>

      {/* Interactive donation widget */}
      <DonationPageClient defaultCompleted={defaultCompleted} />
    </div>
  );
}
