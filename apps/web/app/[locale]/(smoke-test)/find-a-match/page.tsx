import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';

import FindAMatchClient from './FindAMatchClient';
import { MatchSmokeTestTracker } from '@/components/match-smoke-test-tracker';
import { buildPageMetadata } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({
    locale,
    path: '/find-a-match',
    namespace: 'seo.findAMatch',
    noindex: true,
  });
}

interface Props {
  searchParams: Promise<{ payment_intent?: string; redirect_status?: string }>;
}

export default async function FindAMatchPage({ searchParams }: Props) {
  const params = await searchParams;
  const defaultPaymentIntentId =
    params.redirect_status === 'succeeded' && params.payment_intent
      ? params.payment_intent
      : undefined;

  return (
    <>
      <MatchSmokeTestTracker />
      <FindAMatchClient defaultPaymentIntentId={defaultPaymentIntentId} />
    </>
  );
}
