import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BookFacilityView } from './_components/book-facility-view';
import { getFacilityForWebBooking } from './_lib/facility-context';

type Props = {
  params: Promise<{ facilityId: string; locale: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { facilityId, locale } = await params;
  const facility = await getFacilityForWebBooking(facilityId, null, null);
  const t = await getTranslations({ locale, namespace: 'webBook' });

  if (!facility) {
    return { title: t('notFound'), robots: { index: false, follow: false } };
  }

  return {
    title: t('pageTitle', { facility: facility.name }),
    robots: { index: false, follow: false },
  };
}

export default async function WebBookFacilityPage({ params, searchParams }: Props) {
  const { facilityId, locale } = await params;
  const { start, end } = await searchParams;

  const facility = await getFacilityForWebBooking(facilityId, start ?? null, end ?? null);

  if (!facility) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-6xl animate-fade-in px-4 py-8 lg:py-10">
      <BookFacilityView facility={facility} locale={locale} />
    </div>
  );
}
