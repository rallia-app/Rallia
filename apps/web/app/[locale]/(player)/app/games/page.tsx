import { getTranslations } from 'next-intl/server';

import { GamesList } from './games-list';

import { SegmentedControl } from '@/components/app/primitives/segmented-control';

/**
 * The player's own games.
 *
 * Upcoming/past is a query param rather than two routes: it is a filter over one
 * collection, and keeping it in the URL means a tab stays linkable and survives a
 * refresh without inventing /app/games/past.
 */
export default async function MyGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const activeTab = tab === 'past' ? 'past' : 'upcoming';
  const t = await getTranslations('playerMatches');

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">{t('title')}</h1>

      <SegmentedControl
        activeHref={activeTab === 'past' ? '/app/games?tab=past' : '/app/games'}
        segments={[
          { href: '/app/games', label: t('tabs.upcoming') },
          { href: '/app/games?tab=past', label: t('tabs.past') },
        ]}
      />

      <GamesList tab={activeTab} />
    </div>
  );
}
