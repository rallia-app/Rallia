import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import CommunityList from './_components/community-list';
import type { PublicCommunity } from './_components/community-card';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { buildPageMetadata } from '@/lib/seo';

// Public directory — same first page for every visitor, so serve it from the
// ISR cache instead of a function invocation per hit.
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/communities', namespace: 'seo.communities' });
}

const PAGE_SIZE = 12;

async function getInitialCommunities(): Promise<PublicCommunity[]> {
  const supabase = createServiceRoleClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_public_communities', {
    p_player_id: null,
    p_sport_id: null,
    p_offset: 0,
    p_limit: PAGE_SIZE,
  });

  if (error || !data?.length) return [];
  return data as PublicCommunity[];
}

export default async function CommunitiesPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('communitiesPage');
  const communities = await getInitialCommunities();

  return (
    <div className="flex flex-col w-full gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t('subtitle')}</p>
      </div>
      <CommunityList initialCommunities={communities} />
    </div>
  );
}
