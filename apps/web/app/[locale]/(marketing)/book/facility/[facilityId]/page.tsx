import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import { FacilityProfileView } from './_components/facility-profile-view';
import { getFacilityForWebBooking } from './_lib/facility-context';
import { WebBookWizard } from './web-book-wizard';

type Props = {
  params: Promise<{ facilityId: string; locale: string }>;
  searchParams: Promise<{ slot?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { facilityId, locale } = await params;
  const facility = await getFacilityForWebBooking(facilityId, null);
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
  const { slot } = await searchParams;

  const facility = await getFacilityForWebBooking(facilityId, slot ?? null);

  if (!facility) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-6xl animate-fade-in px-4 py-8 lg:py-10">
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
        <FacilityProfileView facility={facility} />

        <div className="w-full lg:sticky lg:top-8">
          <Suspense
            fallback={
              <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card py-24">
                <Loader2 className="size-7 animate-spin text-primary" />
              </div>
            }
          >
            <WebBookWizard facility={facility} locale={locale} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
