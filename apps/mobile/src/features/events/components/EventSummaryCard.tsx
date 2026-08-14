/**
 * Renders an EventSummary as its format's card.
 *
 * The list is unified; the cards are not, and should not be. A tournament card
 * carries prize money, draw format and Circuit Rallia points; a league card
 * carries join mode and roster size. Both already compose the same chrome from
 * the registry, so the only thing missing was one place that picks between
 * them. A new format adds a branch here and nothing else on the list side.
 */

import React from 'react';
import { useEventListColors } from '@rallia/shared-components';
import type { EventSummary } from '@rallia/shared-services';

import { useTranslation } from '../../../hooks';
import { TournamentCard } from '../../tournaments/components/TournamentListScaffold';
import { LeagueCard } from '../../leagues/components/LeagueListScaffold';

interface EventSummaryCardProps {
  event: EventSummary;
  /** Marks cards the caller organizes with an accent chip. */
  currentUserId?: string;
  onPress: () => void;
}

export const EventSummaryCard: React.FC<EventSummaryCardProps> = ({
  event,
  currentUserId,
  onPress,
}) => {
  const { t, locale } = useTranslation();
  const colors = useEventListColors();
  const isOrganizer = !!currentUserId && event.organizerId === currentUserId;

  if (event.engine === 'league') {
    return (
      <LeagueCard
        league={event.league}
        colors={colors}
        t={t}
        isOrganizer={isOrganizer}
        onPress={onPress}
      />
    );
  }

  return (
    <TournamentCard
      tournament={event.tournament}
      colors={colors}
      locale={locale}
      t={t}
      isOrganizer={isOrganizer}
      onPress={onPress}
    />
  );
};

export default EventSummaryCard;
