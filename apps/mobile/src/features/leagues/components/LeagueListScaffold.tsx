/**
 * LeagueListScaffold — the league flavour of the shared event list: maps league
 * status and facts onto the format-neutral card chrome in
 * `@rallia/shared-components`, and hands the rest to `EventListScaffold`.
 */

import React, { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  EventAvatarStrip,
  EventCardShell,
  EventCardSkeleton,
  EventFooterLink,
  EventMetaChip,
  EventMetaRow,
  EventStatusPill,
  formatEventRatingRange,
  useEventListColors,
  type EventListColors,
  type EventTone,
} from '@rallia/shared-components';
import type { LeagueListItem } from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import {
  EventListScaffold,
  type EventListSection,
} from '../../events/components/EventListScaffold';
import { useTranslation, type TranslationKey } from '../../../hooks';

import { LeagueBanner, LEAGUE_BANNER_ASPECT } from './LeagueBanner';

type LeagueStatus = Enums<'league_status'>;
type JoinMode = Enums<'tournament_registration_mode'>;
type Visibility = Enums<'tournament_visibility'>;

const LEAGUE_STATUS_TONE: Record<LeagueStatus, EventTone> = {
  active: 'positive',
  paused: 'neutral',
  closed: 'muted',
};

const JOIN_MODE_KEYS: Record<JoinMode, string> = {
  open: 'leagueDetail.values.open',
  approval: 'leagueDetail.values.approval',
  invite_only: 'leagueDetail.values.inviteOnly',
};
const VISIBILITY_KEYS: Record<Visibility, string> = {
  private: 'leagueDetail.values.private',
  public: 'leagueDetail.values.public',
  community: 'leagueDetail.values.community',
};

/** The shared placeholder, bound to the league banner's shape. */
export const LeagueCardSkeleton: React.FC = () => (
  <EventCardSkeleton bannerAspect={LEAGUE_BANNER_ASPECT} />
);

export const LeagueCard: React.FC<{
  league: LeagueListItem;
  colors: EventListColors;
  t: (k: TranslationKey, options?: Record<string, string | number>) => string;
  onPress: () => void;
  isOrganizer?: boolean;
}> = ({ league, colors, t, onPress, isOrganizer }) => {
  const ratingRange = formatEventRatingRange(league.min_rating, league.max_rating);

  const joinHighlight = useMemo(() => {
    if (league.join_mode !== 'open' || league.status !== 'active') return null;
    return t(JOIN_MODE_KEYS.open as TranslationKey);
  }, [league.join_mode, league.status, t]);

  // Quiet decision facts, dot-separated; special facts (role) keep a chip.
  const metaFacts = [
    ratingRange,
    t(JOIN_MODE_KEYS[league.join_mode] as TranslationKey),
    t(VISIBILITY_KEYS[league.visibility] as TranslationKey),
    league.level,
  ].filter((f): f is string => !!f);

  return (
    <EventCardShell
      colors={colors}
      onPress={onPress}
      testID={`league-card-${league.id}`}
      banner={<LeagueBanner logoUrl={league.logo_url} />}
      bannerTopLeft={
        <EventStatusPill
          tone={LEAGUE_STATUS_TONE[league.status]}
          label={t(`leagueDetail.status.${league.status}`)}
          colors={colors}
          onImage
        />
      }
      title={league.name}
      subtitle={league.venue_name}
      meta={
        <EventMetaRow
          facts={metaFacts}
          colors={colors}
          leadingIcon={ratingRange ? 'analytics' : undefined}
          trailing={
            isOrganizer ? (
              <EventMetaChip
                label={t('leagueList.roleOrganizer')}
                icon="person-outline"
                colors={colors}
                tone="accent"
              />
            ) : null
          }
        />
      }
      footerLeft={
        <EventAvatarStrip
          avatars={league.member_preview}
          countLabel={
            league.member_capacity != null
              ? `${league.member_count}/${league.member_capacity}`
              : String(league.member_count)
          }
          isFull={league.member_capacity != null && league.member_count >= league.member_capacity}
          colors={colors}
        />
      }
      footerRight={
        joinHighlight ? <EventFooterLink label={joinHighlight} color={colors.positiveText} /> : null
      }
    />
  );
};

export type LeagueSection = EventListSection<LeagueListItem>;

interface LeagueListScaffoldProps {
  sections: LeagueSection[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitleKey: TranslationKey;
  emptyDescriptionKey: TranslationKey;
  header?: React.ReactNode;
  /** Marks cards the caller organizes with an accent chip. */
  currentUserId?: string;
  onPressLeague: (league: LeagueListItem) => void;
}

export const LeagueListScaffold: React.FC<LeagueListScaffoldProps> = ({
  sections,
  isLoading,
  isError,
  refetch,
  emptyIcon = 'ribbon-outline',
  emptyTitleKey,
  emptyDescriptionKey,
  header,
  currentUserId,
  onPressLeague,
}) => {
  const { t } = useTranslation();
  const colors = useEventListColors();

  return (
    <EventListScaffold
      sections={sections}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      emptyIcon={emptyIcon}
      emptyTitleKey={emptyTitleKey}
      emptyDescriptionKey={emptyDescriptionKey}
      loadErrorKey="leagueList.loadError"
      retryKey="leagueList.retry"
      header={header}
      skeletonBannerAspect={LEAGUE_BANNER_ASPECT}
      renderCard={league => (
        <LeagueCard
          league={league}
          colors={colors}
          t={t}
          isOrganizer={!!currentUserId && league.organizer_id === currentUserId}
          onPress={() => onPressLeague(league)}
        />
      )}
    />
  );
};
