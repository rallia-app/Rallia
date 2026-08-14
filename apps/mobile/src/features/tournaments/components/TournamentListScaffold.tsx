/**
 * TournamentListScaffold
 *
 * The tournament flavour of the shared event list: maps tournament status and
 * facts onto the format-neutral card chrome in `@rallia/shared-components`,
 * and hands the rest to `EventListScaffold`.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Text,
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
import { formatPrice, tournamentRankingHeadline } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import { bracketTypeToEventFormat, type TournamentListItem } from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import {
  EventListScaffold,
  type EventListSection,
} from '../../events/components/EventListScaffold';
import { EVENT_FORMAT_LABEL_KEY } from '../../events/eventKinds';
import { useTranslation, type TranslationKey } from '../../../hooks';

import { TournamentBanner, TOURNAMENT_BANNER_ASPECT } from './TournamentBanner';

type Status = Enums<'tournament_status'>;

const STATUS_TONE: Record<Status, EventTone> = {
  draft: 'neutral',
  registration_open: 'positive',
  registration_closed: 'neutral',
  in_progress: 'active',
  completed: 'muted',
  cancelled: 'muted',
  archived: 'muted',
};

const ENTRY_FORMAT_KEYS: Record<Enums<'entry_format'>, string> = {
  singles: 'tournamentDetail.values.singles',
  doubles: 'tournamentDetail.values.doubles',
  mixed_doubles: 'tournamentDetail.values.mixedDoubles',
};

const MATCH_FORMAT_KEYS: Record<Enums<'match_format'>, string> = {
  one_set: 'tournamentDetail.values.oneSet',
  two_of_three: 'tournamentDetail.values.twoOfThree',
  three_of_five: 'tournamentDetail.values.threeOfFive',
  pickleball_to_11: 'tournamentDetail.values.pickleballTo11',
  pickleball_to_15: 'tournamentDetail.values.pickleballTo15',
  pickleball_to_21: 'tournamentDetail.values.pickleballTo21',
};

/** The shared placeholder, bound to the tournament banner's shape. */
export const TournamentCardSkeleton: React.FC = () => (
  <EventCardSkeleton bannerAspect={TOURNAMENT_BANNER_ASPECT} />
);

export const TournamentCard: React.FC<{
  tournament: TournamentListItem;
  colors: EventListColors;
  locale: string;
  t: (k: TranslationKey) => string;
  onPress: () => void;
  isOrganizer?: boolean;
}> = ({ tournament, colors, locale, t, onPress, isOrganizer }) => {
  const fmtDate = useCallback(
    (iso: string) => new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    [locale]
  );

  const dateRange = useMemo(() => {
    const sameDay = tournament.start_date.slice(0, 10) === tournament.end_date.slice(0, 10);
    if (sameDay) return fmtDate(tournament.start_date);
    return t('tournamentList.dateRange')
      .replace('{start}', fmtDate(tournament.start_date))
      .replace('{end}', fmtDate(tournament.end_date));
  }, [tournament.start_date, tournament.end_date, fmtDate, t]);

  const registerBy =
    tournament.status === 'registration_open' && tournament.registration_closes_at
      ? t('tournamentList.registerBy').replace('{date}', fmtDate(tournament.registration_closes_at))
      : null;
  const [mountedAt] = useState(() => Date.now());
  const registerByUrgent =
    tournament.status === 'registration_open' &&
    tournament.registration_closes_at != null &&
    new Date(tournament.registration_closes_at).getTime() - mountedAt < 48 * 3600 * 1000;

  const ratingRange = formatEventRatingRange(tournament.min_rating, tournament.max_rating);
  // Only a certified organizer's tournament awards points (same gate as the
  // detail screen) — never advertise points the event can't pay.
  const rankingHeadline = tournament.organizer_is_certified
    ? tournamentRankingHeadline(tournament)
    : null;
  // Always the champion figure, projected or not: the chip is a headline, and
  // the Points tab carries the "up to" nuance.
  const rankingLabel = rankingHeadline
    ? t('tournamentList.rankingPoints').replace('{points}', String(rankingHeadline.points))
    : null;
  const prizeLabel =
    tournament.prize_money_cents && tournament.prize_money_cents > 0
      ? formatPrice(tournament.prize_money_cents, tournament.currency, {
          locale,
          trimZeroCents: true,
        })
      : null;
  // Cost, not payout. Only paid events carry it, so a card without the chip
  // reads as free — and the prize badge stops being the only money on the card.
  const entryFeeLabel =
    tournament.entry_fee_cents > 0
      ? formatPrice(tournament.entry_fee_cents, tournament.currency, {
          locale,
          trimZeroCents: true,
        })
      : null;
  const venue = tournament.venue_name || tournament.city;

  // Quiet decision facts, dot-separated; special facts (points, role) keep a chip.
  // `level` is deliberately left out: the rating range already says who can enter.
  // The draw structure leads the formats, in the same words as the format filter,
  // so a filtered list can be read back against the chip that produced it.
  const metaFacts = [
    ratingRange,
    t(EVENT_FORMAT_LABEL_KEY[bracketTypeToEventFormat(tournament.bracket_type)]),
    t(ENTRY_FORMAT_KEYS[tournament.entry_format] as TranslationKey),
    t(MATCH_FORMAT_KEYS[tournament.match_format] as TranslationKey),
  ].filter((f): f is string => !!f);

  return (
    <EventCardShell
      colors={colors}
      onPress={onPress}
      testID={`tournament-card-${tournament.id}`}
      banner={<TournamentBanner logoUrl={tournament.logo_url} />}
      bannerTopLeft={
        <EventStatusPill
          tone={STATUS_TONE[tournament.status]}
          label={t(`tournamentDetail.status.${tournament.status}`)}
          colors={colors}
          onImage
        />
      }
      /* What the event is worth, both currencies together: cash in the solid
         gold pill, Circuit Rallia points in the lighter one. */
      bannerTopRight={
        <>
          {prizeLabel && (
            <View style={styles.prizeBadge}>
              <Ionicons name="trophy" size={12} color={accent[900]} />
              <Text size="xs" weight="semibold" color={accent[900]} numberOfLines={1}>
                {prizeLabel}
              </Text>
            </View>
          )}
          {rankingLabel && (
            <View style={styles.pointsBadge}>
              <Ionicons name="ribbon" size={12} color={accent[700]} />
              <Text size="xs" weight="semibold" color={accent[700]} numberOfLines={1}>
                {rankingLabel}
              </Text>
            </View>
          )}
        </>
      }
      title={tournament.name}
      subtitle={venue ? `${dateRange} · ${venue}` : dateRange}
      meta={
        <EventMetaRow
          facts={metaFacts}
          colors={colors}
          leadingIcon={ratingRange ? 'analytics' : undefined}
          trailing={
            <>
              {entryFeeLabel && (
                <EventMetaChip
                  label={entryFeeLabel}
                  icon="pricetag-outline"
                  colors={colors}
                  tone="primary"
                />
              )}
              {isOrganizer && (
                <EventMetaChip
                  label={t('tournamentList.roleOrganizer')}
                  icon="person-outline"
                  colors={colors}
                  tone="accent"
                />
              )}
            </>
          }
        />
      }
      footerLeft={
        <EventAvatarStrip
          avatars={tournament.registrant_preview}
          countLabel={`${tournament.registration_count}/${tournament.max_participants}`}
          isFull={tournament.registration_count >= tournament.max_participants}
          colors={colors}
        />
      }
      footerRight={
        registerBy ? (
          <EventFooterLink
            label={registerBy}
            color={registerByUrgent ? colors.chipSecondaryText : colors.positiveText}
          />
        ) : null
      }
    />
  );
};

export type TournamentSection = EventListSection<TournamentListItem>;

interface TournamentListScaffoldProps {
  sections: TournamentSection[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitleKey: TranslationKey;
  emptyDescriptionKey: TranslationKey;
  /** Rendered above the list content in every state (e.g. a nav button). */
  header?: React.ReactNode;
  /** Marks cards the caller organizes with an accent chip. */
  currentUserId?: string;
  onPressTournament: (tournament: TournamentListItem) => void;
}

export const TournamentListScaffold: React.FC<TournamentListScaffoldProps> = ({
  sections,
  isLoading,
  isError,
  refetch,
  emptyIcon = 'trophy-outline',
  emptyTitleKey,
  emptyDescriptionKey,
  header,
  currentUserId,
  onPressTournament,
}) => {
  const { t, locale } = useTranslation();
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
      loadErrorKey="tournamentList.loadError"
      retryKey="tournamentList.retry"
      header={header}
      skeletonBannerAspect={TOURNAMENT_BANNER_ASPECT}
      renderCard={tournament => (
        <TournamentCard
          tournament={tournament}
          colors={colors}
          locale={locale}
          t={t}
          isOrganizer={!!currentUserId && tournament.organizer_id === currentUserId}
          onPress={() => onPressTournament(tournament)}
        />
      )}
    />
  );
};

const styles = StyleSheet.create({
  prizeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    backgroundColor: accent[300],
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
});
