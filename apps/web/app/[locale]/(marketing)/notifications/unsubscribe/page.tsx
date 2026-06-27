import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'notificationsUnsubscribe' });
  return { title: t('successTitle'), robots: { index: false, follow: false } };
}

export default async function NotificationsUnsubscribePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { status } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'notificationsUnsubscribe' });

  const isSuccess = status === 'success';
  const title = isSuccess ? t('successTitle') : t('errorTitle');
  const message = isSuccess ? t('successMessage') : t('errorMessage');

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">{message}</p>
      </div>
    </main>
  );
}
