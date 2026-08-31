/**
 * MatchOrganizerCard
 *
 * Renders a 'match_organizer' chat card: a votable list of suggested time/place
 * options (snapshotted into the message metadata at post time). Every
 * participant thumbs-up the options they'd be good with; once an option has a
 * vote from everyone it becomes "mutual" and any participant can turn it into a
 * real, fully-joined private game (create_casual_match). After creation the card
 * flips to a confirmation linking to the game.
 *
 * Mirrors CourtSystemMessageCard: full-width, reads message.metadata, degrades
 * to plain text if the payload is missing.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { Button, Text } from '@rallia/shared-components';
import { base, spacingPixels, radiusPixels, status as statusColors } from '@rallia/design-system';
import { getMatchWithDetails } from '@rallia/shared-services';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  formatIntuitiveDateInTimezone,
  getProfilePictureUrl,
} from '@rallia/shared-utils';
import type {
  MatchOrganizerMetadata,
  MatchOrganizerOption,
  MessageWithSender,
} from '@rallia/shared-services';
import {
  useMatchTimeVotes,
  usePairingBooking,
  useBookMutualOption,
  useAcceptPairingBooking,
  useToggleMatchTimeVote,
  useCreateCasualMatch,
  useProfilesByIds,
  useSharedAvailability,
} from '@rallia/shared-hooks';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { useMatchDetailSheet } from '#/context/MatchDetailSheetContext';
import * as Analytics from '#/services/analytics';
import { useAuth, useTranslation, useThemeStyles } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';

import { courtStateIcon, courtStateLabel, resolveCourtState } from '../utils/courtState';
import TennisCourtIcon from '../../../../assets/icons/tennis-court.svg';

import {
  ChatCardFallback,
  ChatCardHeader,
  ChatConfirmationBand,
  chatCardShell,
} from './ChatCardShell';

interface MatchOrganizerCardProps {
  message: MessageWithSender;
}

/** Every chip is this tall, glyph or labelled, so the row reads as one band. */
const CHIP_HEIGHT = 24;

const localDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function MatchOrganizerCard({ message }: MatchOrganizerCardProps) {
  const { t, locale } = useTranslation();
  const { colors } = useThemeStyles();
  const { session } = useAuth();
  const { openSheet } = useMatchDetailSheet();
  const currentUserId = session?.user?.id;

  const metadata = (message.metadata ?? null) as MatchOrganizerMetadata | null;

  // Hooks must run unconditionally (the fallback return is below them).
  const { data: votes = [] } = useMatchTimeVotes(message.id);
  const toggleVote = useToggleMatchTimeVote();
  const createMatch = useCreateCasualMatch();
  const [creatingIndex, setCreatingIndex] = useState<number | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const participants = useMemo(() => metadata?.participant_ids ?? [], [metadata]);

  const votersByOption = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const v of votes) {
      if (!map.has(v.option_index)) map.set(v.option_index, new Set());
      map.get(v.option_index)!.add(v.player_id);
    }
    return map;
  }, [votes]);

  const createdMatchId = metadata?.created_match_id ?? null;

  // Scheduling funnel: on a funnel event the options were built from the phase
  // snapshots, so a slot every side declared free is pre-agreed and books in
  // one tap instead of collecting thumbs (scheduling-funnel.md § 5.3). The
  // card records this itself, because a round chat carries no tournament_id to
  // walk back from, and because it is a fact about this snapshot.
  const pairingId = metadata?.tournament_match_id ?? null;
  const funnelEnabled = !!pairingId && metadata?.funnel === true;
  const { data: booking } = usePairingBooking(pairingId ?? undefined, funnelEnabled);
  const bookOption = useBookMutualOption();
  const acceptBooking = useAcceptPairingBooking();

  // Players read the list like a calendar, so it is shown chronologically. The
  // true array index rides along because votes are stored positionally
  // (match_time_vote.option_index): a proposal appended to the end of the
  // snapshot has to render in its date position without its votes moving.
  const orderedOptions = useMemo(
    () =>
      (metadata?.options ?? [])
        .map((option, index) => ({ option, index }))
        .sort((a, b) => Date.parse(a.option.slot_start) - Date.parse(b.option.slot_start)),
    [metadata]
  );

  // Availability editor, opened with pairing context so the grid draws the
  // opponent's free hours underneath the player's own. Saving regenerates this
  // card, so a widened week turns "no shared times" into real options in place.
  const opponentIds = useMemo(
    () => participants.filter(id => id !== currentUserId),
    [participants, currentUserId]
  );
  const { data: opponentProfiles = {} } = useProfilesByIds(opponentIds);
  const { data: myGrid } = useSharedAvailability(currentUserId ? [currentUserId] : undefined);

  const opponentLabel = useMemo(
    () =>
      Object.values(opponentProfiles)
        .map(p => p.first_name)
        .filter(Boolean)
        .join(', ') || null,
    [opponentProfiles]
  );

  const openAvailabilityEditor = useCallback(() => {
    void lightHaptic();
    void SheetManager.show('player-availabilities', {
      payload: {
        mode: 'edit',
        initialData: myGrid ? new Set(myGrid) : undefined,
        opponentIds,
        opponentName: opponentLabel,
        tournamentMatchId: metadata?.tournament_match_id ?? null,
      },
    });
  }, [myGrid, opponentIds, opponentLabel, metadata?.tournament_match_id]);

  // The funnel floor: when the engine has nothing to offer (no shared hours, no
  // facility it knows), a participant names a slot themselves and it becomes a
  // normal votable option. Without this the card can dead-end.
  const openCustomSlotSheet = useCallback(() => {
    void lightHaptic();
    void SheetManager.show('match-organizer-custom-slot', {
      payload: {
        messageId: message.id,
        conversationId: message.conversation_id,
      },
    });
  }, [message.id, message.conversation_id]);

  const handleToggle = useCallback(
    (optionIndex: number) => {
      if (!currentUserId || createdMatchId) return;
      void lightHaptic();
      const voters = votersByOption.get(optionIndex) ?? new Set<string>();
      const removed = voters.has(currentUserId);
      toggleVote.mutate({
        messageId: message.id,
        playerId: currentUserId,
        optionIndex,
        hasVoted: removed,
      });
      Analytics.matchOrganizerVoteCast({
        sport_id: metadata!.sport_id,
        format: metadata!.format,
        participant_count: participants.length,
        option_index: optionIndex,
        option_tier: metadata!.options[optionIndex]?.tier ?? 'usually_free',
        removed,
      });
    },
    [currentUserId, createdMatchId, votersByOption, toggleVote, message.id, metadata, participants]
  );

  const handleCreate = useCallback(
    async (option: MatchOrganizerOption, optionIndex: number) => {
      if (!currentUserId || createMatch.isPending || createdMatchId) return;
      void lightHaptic();
      setCreatingIndex(optionIndex);
      try {
        const matchId = await createMatch.mutateAsync({
          sportId: metadata!.sport_id,
          slotStart: option.slot_start,
          playerIds: participants,
          format: metadata!.format,
          facilityId: option.facility_id ?? null,
          // A hand-proposed place has no facility row, so it rides along as the
          // game's location name instead of leaving the game location TBD.
          locationName: option.facility_id ? null : (option.place_name ?? null),
          sourceMessageId: message.id,
          optionIndex,
          conversationId: message.conversation_id,
        });
        void successHaptic();
        Analytics.matchOrganizerMatchCreated({
          match_id: matchId,
          sport_id: metadata!.sport_id,
          format: metadata!.format,
          participant_count: participants.length,
          option_index: optionIndex,
          option_tier: option.tier,
          price_cents: option.price_cents,
        });
      } catch (error) {
        console.error('Failed to create game from organizer card:', error);
        void warningHaptic();
      } finally {
        setCreatingIndex(null);
      }
    },
    [
      currentUserId,
      createMatch,
      createdMatchId,
      metadata,
      participants,
      message.id,
      message.conversation_id,
    ]
  );

  // One tap on a pre-agreed slot: the RPC creates the game, links it to the
  // pairing and opens the 24 h window the other side answers in.
  const handleBook = useCallback(
    async (optionIndex: number) => {
      if (!currentUserId || bookOption.isPending || createdMatchId || !pairingId) return;
      void lightHaptic();
      setCreatingIndex(optionIndex);
      try {
        await bookOption.mutateAsync({
          messageId: message.id,
          optionIndex,
          conversationId: message.conversation_id,
          tournamentMatchId: pairingId,
        });
        void successHaptic();
      } catch (error) {
        console.error('Failed to book a mutual slot:', error);
        void warningHaptic();
      } finally {
        setCreatingIndex(null);
      }
    },
    [currentUserId, bookOption, createdMatchId, pairingId, message.id, message.conversation_id]
  );

  const handleAccept = useCallback(async () => {
    if (!pairingId || acceptBooking.isPending) return;
    void lightHaptic();
    try {
      await acceptBooking.mutateAsync({
        tournamentMatchId: pairingId,
        conversationId: message.conversation_id,
      });
      void successHaptic();
    } catch (error) {
      console.error('Failed to accept the booking:', error);
      void warningHaptic();
    }
  }, [pairingId, acceptBooking, message.conversation_id]);

  const handleOpenMatch = useCallback(async () => {
    if (!createdMatchId || isOpening) return;
    void lightHaptic();
    setIsOpening(true);
    try {
      const match = await getMatchWithDetails(createdMatchId);
      if (match) openSheet(match as MatchDetailData);
    } finally {
      setIsOpening(false);
    }
  }, [createdMatchId, isOpening, openSheet]);

  // User-friendly date label: Today / Tomorrow / weekday / "Mon, Jan 6".
  const friendlyDate = useCallback(
    (date: Date): string => {
      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = formatIntuitiveDateInTimezone(localDateKey(date), deviceTz, locale);
      return r.translationKey ? t(r.translationKey) : r.label;
    },
    [locale, t]
  );

  // Zero-overlap card: the engine found no slot free for every participant.
  // Deliberately not a plain-text fallback — it explains and points at the fix.
  if (metadata?.no_overlap && (metadata.options?.length ?? 0) === 0) {
    return (
      <View style={chatCardShell.wrapper}>
        <View
          style={[
            chatCardShell.card,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <ChatCardHeader
            icon="calendar-outline"
            accent={colors.primary}
            title={t('matchOrganizer.card.noOverlapTitle')}
            subtitle={t('matchOrganizer.card.noOverlapBody')}
            colors={colors}
          />
          {/* Proposing a time leads here: the pair may simply have hours they
              never declared, and asking them to repaint a whole week first is
              the slower fix. Editing availability stays available underneath.
              Both actions span the card so it has no dead side. */}
          <View style={chatCardShell.cardCta}>
            <Button
              variant="primary"
              size="sm"
              fullWidth
              onPress={openCustomSlotSheet}
              leftIcon={<Ionicons name="add-circle-outline" size={16} color={base.white} />}
            >
              {t('matchOrganizer.custom.cta')}
            </Button>
            <Button variant="ghost" size="sm" fullWidth onPress={openAvailabilityEditor}>
              {t('matchOrganizer.card.noOverlapCta')}
            </Button>
          </View>
        </View>
      </View>
    );
  }

  // Defensive: no structured payload -> plain text (shouldn't happen).
  if (!metadata || !Array.isArray(metadata.options) || metadata.options.length === 0) {
    return <ChatCardFallback text={message.content} colors={colors} />;
  }

  const isParticipant = currentUserId ? participants.includes(currentUserId) : false;
  const accent = colors.primary;

  const formatPrice = (cents: number | null): string | null => {
    if (cents == null) return null;
    if (cents === 0) return t('matchOrganizer.cost.free');
    return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  };

  // ---- Created state -------------------------------------------------------
  if (createdMatchId) {
    const confirmedIdx = metadata.confirmed_option_index ?? null;
    const confirmed =
      confirmedIdx != null && metadata.options[confirmedIdx]
        ? metadata.options[confirmedIdx]
        : null;
    const start = confirmed ? new Date(confirmed.slot_start) : null;
    const success = statusColors.success.DEFAULT;

    // A funnel booking is tentative until the other side answers or the 24 h
    // window runs out (scheduling-funnel.md § 5.4). The band below says which,
    // and gives the side that did not book their say.
    const isTentative =
      !!booking && booking.accepted_at == null && Date.parse(booking.tentative_until) > Date.now();
    const iBooked = booking?.booked_by === currentUserId;

    // The same confirmation band the court-booked card uses, so every
    // "it happened" message in a chat reads identically.
    return (
      <>
        <ChatConfirmationBand
          accent={isTentative ? accent : success}
          title={t(isTentative ? 'matchOrganizer.card.tentative' : 'matchOrganizer.card.created')}
          lines={[
            confirmed && start
              ? `${friendlyDate(start)} · ${formatTimeOfDay(start, locale)}`
              : t('matchOrganizer.card.createdSubtitle'),
            confirmed?.facility_name ?? confirmed?.place_name,
          ]}
          onPress={() => {
            void handleOpenMatch();
          }}
          isOpening={isOpening}
          accessibilityLabel={t('matchOrganizer.card.viewGame')}
          colors={colors}
        />
        {isTentative && (
          <View style={styles.tentativeBand}>
            <Text size="xs" color={colors.textMuted} style={styles.tentativeText}>
              {t(
                iBooked
                  ? 'matchOrganizer.card.tentativeWaiting'
                  : 'matchOrganizer.card.tentativeAsk'
              ).replace('{name}', opponentLabel ?? '')}
            </Text>
            {!iBooked && isParticipant && (
              <Button
                onPress={() => {
                  void handleAccept();
                }}
                loading={acceptBooking.isPending}
                disabled={acceptBooking.isPending}
                size="sm"
                fullWidth
                testID="booking-accept"
              >
                {t('matchOrganizer.card.tentativeAccept')}
              </Button>
            )}
          </View>
        )}
      </>
    );
  }

  // ---- Voting state --------------------------------------------------------
  return (
    <View style={chatCardShell.wrapper}>
      <View
        style={[
          chatCardShell.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <ChatCardHeader
          icon="calendar-outline"
          accent={accent}
          title={`${t('matchOrganizer.card.title')}${metadata.sport_name ? ` · ${metadata.sport_name}` : ''}`}
          subtitle={t('matchOrganizer.card.subtitlePrompt')}
          colors={colors}
        />

        <View style={styles.options}>
          {orderedOptions.map(({ option, index }) => {
            const voters = votersByOption.get(index) ?? new Set<string>();
            const hasVoted = currentUserId ? voters.has(currentUserId) : false;
            const votedMutual = participants.length > 0 && participants.every(p => voters.has(p));
            // On the funnel the hours came from the phase snapshots, so a slot
            // every side declared free is already agreed in principle and asks
            // for no thumbs. A custom or one-sided slot still needs them:
            // only one side's hours back it (scheduling-funnel.md § 5.3).
            const preAgreed =
              funnelEnabled &&
              option.tier !== 'custom' &&
              participants.length > 0 &&
              (option.free_count ?? 0) >= participants.length;
            const isMutual = votedMutual || preAgreed;
            const start = new Date(option.slot_start);
            const dateLabel = friendlyDate(start);
            const timeLabel = formatTimeOfDay(start, locale);
            const priceLabel = formatPrice(option.price_cents);
            const courtCount = option.court_count ?? 0;
            const courtState = resolveCourtState(option);
            const courtLabel = courtStateLabel(courtState, courtCount, t);
            // A hand-proposed slot carries no court and no availability data, so
            // it must not borrow the engine's "usually free" reassurance.
            const isCustom = option.tier === 'custom';
            const proposerLabel = !isCustom
              ? null
              : option.proposed_by && option.proposed_by === currentUserId
                ? t('matchOrganizer.custom.proposedByYou')
                : t('matchOrganizer.custom.proposedBy').replace(
                    '{name}',
                    (option.proposed_by
                      ? opponentProfiles[option.proposed_by]?.first_name
                      : null) ?? t('matchOrganizer.custom.proposedByFallback')
                  );
            const isCreatingThis = creatingIndex === index;
            // A court BOTH players already favourite is better evidence the slot
            // will happen than any court feed, so it gets its own chip.
            const sharedFavorite =
              option.fav_count != null &&
              participants.length > 0 &&
              option.fav_count >= participants.length;
            // The state that matters most on this card: someone ELSE already
            // liked this slot and it is waiting on you. A bare count next to the
            // thumb was invisible, so their FACES sit beside the thumb, wearing
            // one small thumbs-up badge, and the row takes a firmer border.
            const otherVoters = [...voters].filter(id => id !== currentUserId);
            const awaitingMe = !isMutual && otherVoters.length > 0;
            // Screen readers hear what sighted users infer from the faces.
            const votersA11y =
              otherVoters.length === 0
                ? undefined
                : otherVoters.length === 1
                  ? t('matchOrganizer.card.likedBy').replace(
                      '{name}',
                      opponentProfiles[otherVoters[0]]?.first_name ??
                        t('matchOrganizer.custom.proposedByFallback')
                    )
                  : t('matchOrganizer.card.likedByCount').replace(
                      '{count}',
                      String(otherVoters.length)
                    );

            return (
              <View
                key={`${option.slot_start}-${option.facility_id}-${index}`}
                style={[
                  styles.option,
                  {
                    borderColor: isMutual ? accent : awaitingMe ? `${accent}80` : colors.border,
                    backgroundColor: isMutual
                      ? `${accent}15`
                      : awaitingMe
                        ? `${accent}0A`
                        : colors.buttonInactive,
                  },
                ]}
              >
                {/* Row 1: when and where, with the action beside it. */}
                <View style={styles.optionHeader}>
                  <View style={styles.optionInfo}>
                    <Text size="sm" weight="semibold" color={colors.text}>
                      {dateLabel} · {timeLabel}
                    </Text>
                    {option.facility_name ? (
                      <Text size="xs" color={colors.textMuted} style={styles.optionFacility}>
                        {option.facility_name}
                      </Text>
                    ) : null}
                  </View>

                  {/* Who already liked this slot, as faces: one badge on the
                      stack says these are likes, not just members. */}
                  {otherVoters.length > 0 ? (
                    <View style={styles.voterCluster} accessibilityLabel={votersA11y}>
                      {otherVoters.slice(0, 3).map((id, i) => {
                        const uri = getProfilePictureUrl(
                          opponentProfiles[id]?.profile_picture_url ?? null
                        );
                        return (
                          <View
                            key={id}
                            style={[
                              styles.voterAvatar,
                              i > 0 && styles.voterAvatarOverlap,
                              { backgroundColor: colors.buttonInactive },
                            ]}
                          >
                            {uri ? (
                              <Image source={{ uri }} style={styles.voterAvatarImg} />
                            ) : (
                              <Ionicons name="person" size={15} color={colors.textMuted} />
                            )}
                          </View>
                        );
                      })}
                      <View style={[styles.voterBadge, { backgroundColor: accent }]}>
                        <Ionicons name="thumbs-up" size={9} color={base.white} />
                      </View>
                    </View>
                  ) : null}

                  {isMutual ? (
                    <Pressable
                      onPress={() => {
                        // The funnel's booking records the tentative window and
                        // tells the other side; the plain create does neither.
                        void (preAgreed ? handleBook(index) : handleCreate(option, index));
                      }}
                      disabled={createMatch.isPending || bookOption.isPending || !isParticipant}
                      style={[styles.createBtn, { backgroundColor: accent }]}
                    >
                      {isCreatingThis ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text size="xs" weight="semibold" color="#fff">
                          {t('matchOrganizer.card.createGame')}
                        </Text>
                      )}
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => handleToggle(index)}
                      disabled={!isParticipant}
                      style={[
                        styles.voteBtn,
                        {
                          borderColor: hasVoted ? accent : colors.border,
                          backgroundColor: hasVoted ? accent : 'transparent',
                        },
                      ]}
                    >
                      <Ionicons
                        name={hasVoted ? 'thumbs-up' : 'thumbs-up-outline'}
                        size={16}
                        color={hasVoted ? '#fff' : colors.textMuted}
                      />
                    </Pressable>
                  )}
                </View>

                {/* Row 2: the chips, across the full width. */}
                <View style={styles.optionChips}>
                  {isCustom ? (
                    <View style={[styles.courtPill, { backgroundColor: accent + '1A' }]}>
                      <Ionicons name="person-outline" size={12} color={accent} />
                      <Text
                        size="xs"
                        weight="semibold"
                        color={accent}
                        numberOfLines={1}
                        style={styles.pillLabel}
                      >
                        {proposerLabel}
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.courtPill,
                        {
                          backgroundColor:
                            courtState === 'confirmed'
                              ? statusColors.success.DEFAULT + '1A'
                              : colors.textMuted + '26',
                        },
                      ]}
                    >
                      {courtState === 'confirmed' ? (
                        <TennisCourtIcon
                          width={13}
                          height={13}
                          stroke={statusColors.success.DEFAULT}
                          style={styles.courtIcon}
                        />
                      ) : (
                        <Ionicons
                          name={courtStateIcon(courtState)}
                          size={12}
                          color={colors.textMuted}
                        />
                      )}
                      <Text
                        size="xs"
                        weight="semibold"
                        color={
                          courtState === 'confirmed'
                            ? statusColors.success.DEFAULT
                            : colors.textMuted
                        }
                        numberOfLines={1}
                        style={styles.pillLabel}
                      >
                        {courtLabel}
                        {courtState === 'confirmed' && priceLabel ? ` · ${priceLabel}` : ''}
                      </Text>
                    </View>
                  )}

                  {sharedFavorite ? (
                    <View
                      style={[
                        styles.courtPill,
                        { backgroundColor: statusColors.success.DEFAULT + '1A' },
                      ]}
                    >
                      <Ionicons name="star" size={12} color={statusColors.success.DEFAULT} />
                      <Text
                        size="xs"
                        weight="semibold"
                        color={statusColors.success.DEFAULT}
                        numberOfLines={1}
                        style={styles.pillLabel}
                      >
                        {t('matchOrganizer.availability.favoriteShared')}
                      </Text>
                    </View>
                  ) : null}

                  {/* A voted option the engine stopped returning is kept so the
                      agreement does not vanish, but it is no longer real. */}
                  {option.stale ? (
                    <View
                      style={[
                        styles.courtPill,
                        { backgroundColor: statusColors.warning.DEFAULT + '1A' },
                      ]}
                    >
                      <Ionicons
                        name="alert-circle-outline"
                        size={12}
                        color={statusColors.warning.DEFAULT}
                      />
                      <Text
                        size="xs"
                        weight="semibold"
                        color={statusColors.warning.DEFAULT}
                        numberOfLines={1}
                        style={styles.pillLabel}
                      >
                        {t('matchOrganizer.card.staleOption')}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {/* None of these work? Name your own slot rather than falling back to
            free-text chat, which is where pairings stall. */}
        {isParticipant ? (
          <View style={chatCardShell.cardCta}>
            {/* Deliberately `secondary`, not `primary`: the primary action on
                this card is agreeing on one of the times above, and a filled
                button here would outrank the "create" buttons on the rows. */}
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              onPress={openCustomSlotSheet}
              leftIcon={<Ionicons name="add-circle-outline" size={16} color={accent} />}
            >
              {t('matchOrganizer.custom.cta')}
            </Button>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default MatchOrganizerCard;

const styles = StyleSheet.create({
  tentativeBand: {
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  tentativeText: {
    textAlign: 'center',
  },
  options: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[1.5],
  },
  option: {
    gap: spacingPixels[2],
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  optionChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  optionInfo: {
    flex: 1,
    gap: 2,
  },
  optionFacility: {
    marginTop: 1,
  },
  // The facepile: overlapping voter avatars sharing ONE thumbs-up badge, so a
  // face on a row can only mean "this person liked this time".
  voterCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  // 32pt matches the thumb button's height, so faces and button sit flush.
  voterAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  voterAvatarOverlap: {
    marginLeft: -spacingPixels[2.5],
  },
  voterAvatarImg: {
    width: '100%',
    height: '100%',
  },
  voterBadge: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginLeft: -spacingPixels[2.5],
    marginBottom: -1,
  },
  courtPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
    borderRadius: 999,
    paddingHorizontal: spacingPixels[2],
    // Every chip is exactly CHIP_HEIGHT tall. Left to their content a labelled
    // pill measures its 12px line at a 1.5 ratio plus padding while a glyph pill
    // measures only the 12px icon, so the glyphs came out 6pt shorter.
    height: CHIP_HEIGHT,
    // The chips stay on ONE line: the pill shrinks and its label ellipsizes
    // rather than wrapping onto a second row. flexShrink defaults to 0 in RN,
    // so both the pill and the label below have to opt in.
    flexShrink: 1,
    minWidth: 0,
  },
  pillLabel: {
    flexShrink: 1,
  },
  courtIcon: {
    transform: [{ rotate: '90deg' }],
  },
  voteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    minWidth: 44,
    justifyContent: 'center',
  },
  createBtn: {
    borderRadius: 999,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    minWidth: 72,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
