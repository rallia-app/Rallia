import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QueryProvider } from '@/components/query-provider';
import { SharedSupabaseSync } from '@/components/shared-supabase-sync';

import { getMatchForWebJoin } from '../_lib/match-context';
import { MatchChat } from './match-chat';

type Props = {
  params: Promise<{ matchId: string; locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matchId, locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webJoin' });
  const match = await getMatchForWebJoin(matchId);

  if (!match) {
    return { title: t('notFound'), robots: { index: false, follow: false } };
  }

  return {
    title: t('chat.title'),
    robots: { index: false, follow: false },
  };
}

export default async function WebJoinMatchChatPage({ params }: Props) {
  const { matchId } = await params;
  const match = await getMatchForWebJoin(matchId);

  if (!match) {
    notFound();
  }

  return (
    <div className="w-full animate-fade-in px-4 py-6">
      <QueryProvider>
        <SharedSupabaseSync />
        <MatchChat matchId={matchId} />
      </QueryProvider>
    </div>
  );
}
