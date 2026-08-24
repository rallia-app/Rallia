import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { Card } from '@/components/ui/card';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'digestUnsubscribe' });
  return { title: t('successTitle'), robots: { index: false, follow: false } };
}

export default async function DigestUnsubscribePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { status } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'digestUnsubscribe' });

  const isSuccess = status === 'success';
  const title = isSuccess ? t('successTitle') : t('errorTitle');
  const message = isSuccess ? t('successMessage') : t('errorMessage');

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Card className="p-8">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <a
          href={`/api/go?to=notificationPreferences&locale=${locale}&src=digest_unsubscribe`}
          className="mt-6 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t('managePreferences')}
        </a>
      </Card>
    </div>
  );
}
