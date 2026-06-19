import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { MatchProfileView } from './_components/match-profile-view';
import { getMatchForWebJoin } from './_lib/match-context';
import { WebJoinWizard } from './web-join-wizard';

import { Loader2 } from 'lucide-react';

type Props = {
  params: Promise<{ matchId: string; locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matchId, locale } = await params;
  const match = await getMatchForWebJoin(matchId);
  const t = await getTranslations({ locale, namespace: 'webJoin' });

  if (!match) {
    return { title: t('notFound'), robots: { index: false, follow: false } };
  }

  const sport = match.sport?.name ?? 'Game';
  return {
    title: t('pageTitle', { sport }),
    robots: { index: false, follow: false },
  };
}

export default async function WebJoinMatchPage({ params }: Props) {
  const { matchId, locale } = await params;
  const match = await getMatchForWebJoin(matchId);

  if (!match) {
    notFound();
  }

  return (
    <div className="w-full max-w-6xl mx-auto animate-fade-in px-4 py-8 lg:py-10">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-8 lg:gap-10 items-start">
        <MatchProfileView match={match} />

        <div className="lg:sticky lg:top-8 w-full">
          <Suspense
            fallback={
              <div className="flex flex-col items-center gap-3 py-24 rounded-2xl border bg-card">
                <Loader2 className="size-7 animate-spin text-primary" />
              </div>
            }
          >
            <WebJoinWizard match={match} locale={locale} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
