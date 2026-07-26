'use client';

import { useMemo } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  PAST_FILTER_OPTIONS,
  UPCOMING_FILTER_OPTIONS,
  useAuth,
  usePlayerMatchFilters,
  usePlayerMatches,
} from '@rallia/shared-hooks';
import { getPastDateSection, getUpcomingDateSection } from '@rallia/shared-utils';
import type { MatchWithDetails } from '@rallia/shared-types';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/app/primitives/empty-state';
import { ErrorState } from '@/components/app/primitives/error-state';
import { FilterChips } from '@/components/app/primitives/filter-chips';
import { ListSkeleton } from '@/components/app/skeletons/list-skeletons';
import { MyGameCard } from '@/components/app/cards/my-game-card';
import { useSport } from '@/components/app/sport-provider';
import { useSupabase } from '@/hooks/use-supabase';
import { Link } from '@/i18n/navigation';

/** Maps a filter id to its `playerMatches.filters.*` key (camelCase in the JSON). */
const FILTER_LABEL_KEYS: Record<string, string> = {
  all: 'all',
  hosting: 'hosting',
  confirmed: 'confirmed',
  waiting: 'waiting',
  needs_players: 'needsPlayers',
  feedback_needed: 'feedbackNeeded',
  completed: 'completed',
  hosted: 'hosted',
  unfilled: 'unfilled',
  cancelled: 'cancelled',
  private: 'private',
};

export function GamesList({ tab }: { tab: 'upcoming' | 'past' }) {
  const t = useTranslations('playerMatches');
  const tGames = useTranslations('gamesPage');
  const tMatches = useTranslations('matches');
  const supabase = useSupabase();
  const { session } = useAuth({ client: supabase });
  const { selectedSport } = useSport();

  const filters = usePlayerMatchFilters();
  const activeFilter = tab === 'upcoming' ? filters.upcomingFilter : filters.pastFilter;

  const { matches, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } =
    usePlayerMatches({
      userId: session?.user?.id,
      timeFilter: tab,
      sportId: selectedSport?.id,
      statusFilter: activeFilter,
      enabled: !!session?.user?.id,
    });

  const chips = (tab === 'upcoming' ? UPCOMING_FILTER_OPTIONS : PAST_FILTER_OPTIONS).map(value => ({
    value,
    label: t(`filters.${FILTER_LABEL_KEYS[value] ?? value}`),
  }));

  // Grouped by the same date buckets mobile uses (Today / This Week / …) so a long
  // list stays scannable instead of being one undifferentiated run of cards. Past
  // matches bucket backwards (Yesterday / Last Week / Earlier), hence the two helpers.
  const sections = useMemo(() => {
    const grouped = new Map<string, MatchWithDetails[]>();
    for (const match of matches) {
      const section =
        tab === 'upcoming'
          ? getUpcomingDateSection(match.match_date)
          : getPastDateSection(match.match_date);
      const existing = grouped.get(section);
      if (existing) existing.push(match);
      else grouped.set(section, [match]);
    }
    return Array.from(grouped.entries());
  }, [matches, tab]);

  if (error) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <FilterChips
        chips={chips}
        selected={activeFilter}
        onSelect={value =>
          tab === 'upcoming'
            ? filters.toggleUpcomingFilter(value as never)
            : filters.togglePastFilter(value as never)
        }
      />

      {isLoading ? (
        <ListSkeleton kind="game" count={3} />
      ) : matches.length === 0 ? (
        <EmptyState
          icon={CalendarPlus}
          title={
            activeFilter !== 'all'
              ? t('emptyFiltered.title')
              : tab === 'upcoming'
                ? t('emptyUpcoming.title')
                : t('emptyPast.title')
          }
          description={
            activeFilter !== 'all'
              ? t('emptyFiltered.description', {
                  filter: t(`filters.${FILTER_LABEL_KEYS[activeFilter] ?? activeFilter}`),
                })
              : tab === 'upcoming'
                ? t('emptyUpcoming.description')
                : t('emptyPast.description')
          }
          action={
            tab === 'upcoming' && activeFilter === 'all' ? (
              <Button asChild>
                <Link href="/app/games/find">{tMatches('findMatch')}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {sections.map(([section, sectionMatches]) => (
            <section key={section} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`time.${section}`)}
              </h2>
              {sectionMatches.map(match => (
                <MyGameCard key={match.id} match={match} />
              ))}
            </section>
          ))}

          {hasNextPage && (
            <Button
              variant="outline"
              className="w-full"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {tGames('loadMore')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
