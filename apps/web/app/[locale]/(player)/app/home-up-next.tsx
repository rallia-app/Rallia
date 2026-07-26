'use client';

import { CalendarPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth, usePlayerMatches } from '@rallia/shared-hooks';

import { EmptyState } from '@/components/app/primitives/empty-state';
import { ErrorState } from '@/components/app/primitives/error-state';
import { ListSkeleton } from '@/components/app/skeletons/list-skeletons';
import { MyGameCard } from '@/components/app/cards/my-game-card';
import { SectionHeader } from '@/components/app/primitives/section-header';
import { useSport } from '@/components/app/sport-provider';
import { useSupabase } from '@/hooks/use-supabase';

/**
 * "Up next" — the player's agenda, top of Home.
 *
 * v0 shows casual games only. The IA's target is a single chronological rail merging
 * games, tournament matches and league sessions; those two sources arrive with the
 * Compete phases, and this composes them in rather than being rebuilt.
 */
export function HomeUpNext() {
  const t = useTranslations('home');
  const supabase = useSupabase();
  const { session } = useAuth({ client: supabase });
  const { selectedSport } = useSport();

  const { matches, isLoading, error, refetch } = usePlayerMatches({
    userId: session?.user?.id,
    timeFilter: 'upcoming',
    sportId: selectedSport?.id,
    // Home is a summary, not the list — three keeps the rail short enough that the
    // Play grid below stays above the fold.
    limit: 3,
    enabled: !!session?.user?.id,
  });

  return (
    <section className="space-y-3">
      <SectionHeader title={t('myMatches')} actionHref="/app/games" actionLabel={t('viewAll')} />

      {error ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <ListSkeleton kind="game" count={2} />
      ) : matches.length === 0 ? (
        <EmptyState
          icon={CalendarPlus}
          title={t('myMatchesEmpty.title')}
          description={t('myMatchesEmpty.description')}
        />
      ) : (
        <div className="space-y-3">
          {matches.map(match => (
            <MyGameCard key={match.id} match={match} />
          ))}
        </div>
      )}
    </section>
  );
}
