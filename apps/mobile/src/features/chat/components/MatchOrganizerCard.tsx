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
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, status as statusColors } from '@rallia/design-system';
import { getMatchWithDetails } from '@rallia/shared-services';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  formatIntuitiveDateInTimezone,
} from '@rallia/shared-utils';
import type {
  MatchOrganizerMetadata,
  MatchOrganizerOption,
  MessageWithSender,
} from '@rallia/shared-services';
import {
  useMatchTimeVotes,
  useToggleMatchTimeVote,
  useCreateCasualMatch,
} from '@rallia/shared-hooks';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { useMatchDetailSheet } from '#/context/MatchDetailSheetContext';
import { useAuth, useTranslation, useThemeStyles } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';
import TennisCourtIcon from '../../../../assets/icons/tennis-court.svg';

interface MatchOrganizerCardProps {
  message: MessageWithSender;
}

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

  const handleToggle = useCallback(
    (optionIndex: number) => {
      if (!currentUserId || createdMatchId) return;
      void lightHaptic();
      const voters = votersByOption.get(optionIndex) ?? new Set<string>();
      toggleVote.mutate({
        messageId: message.id,
        playerId: currentUserId,
        optionIndex,
        hasVoted: voters.has(currentUserId),
      });
    },
    [currentUserId, createdMatchId, votersByOption, toggleVote, message.id]
  );

  const handleCreate = useCallback(
    async (option: MatchOrganizerOption, optionIndex: number) => {
      if (!currentUserId || createMatch.isPending || createdMatchId) return;
      void lightHaptic();
      setCreatingIndex(optionIndex);
      try {
        await createMatch.mutateAsync({
          sportId: metadata!.sport_id,
          slotStart: option.slot_start,
          playerIds: participants,
          format: metadata!.format,
          facilityId: option.facility_id ?? null,
          sourceMessageId: message.id,
          optionIndex,
          conversationId: message.conversation_id,
        });
        void successHaptic();
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

  // Defensive: no structured payload -> plain text (shouldn't happen).
  if (!metadata || !Array.isArray(metadata.options) || metadata.options.length === 0) {
    return (
      <View style={styles.fallback}>
        <Text size="sm" color={colors.textMuted} style={styles.center}>
          {message.content}
        </Text>
      </View>
    );
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

    return (
      <View style={styles.wrapper}>
        <Pressable
          onPress={() => {
            void handleOpenMatch();
          }}
          style={[
            styles.card,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <View style={[styles.iconCircle, { backgroundColor: success + '1A' }]}>
            <Ionicons name="checkmark-circle" size={20} color={success} />
          </View>
          <View style={styles.body}>
            <Text size="sm" weight="semibold" color={colors.text}>
              {t('matchOrganizer.card.created')}
            </Text>
            <Text size="xs" color={colors.textMuted} style={styles.subtitle}>
              {confirmed && start
                ? `${friendlyDate(start)} · ${formatTimeOfDay(start, locale)}${
                    confirmed.facility_name ? ` · ${confirmed.facility_name}` : ''
                  }`
                : t('matchOrganizer.card.createdSubtitle')}
            </Text>
            <View style={[styles.cta, { backgroundColor: success }]}>
              <Text
                size="sm"
                weight="semibold"
                color="#fff"
                style={isOpening ? styles.ctaLabelHidden : undefined}
              >
                {t('matchOrganizer.card.viewGame')}
              </Text>
              {isOpening ? (
                <View style={styles.ctaSpinner} pointerEvents="none">
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
      </View>
    );
  }

  // ---- Voting state --------------------------------------------------------
  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={[styles.iconCircle, { backgroundColor: accent + '1A' }]}>
            <Ionicons name="calendar-outline" size={20} color={accent} />
          </View>
          <View style={styles.headerText}>
            <Text size="sm" weight="semibold" color={colors.text} lineHeight="tight">
              {t('matchOrganizer.card.title')}
              {metadata.sport_name ? ` · ${metadata.sport_name}` : ''}
            </Text>
            <Text
              size="xs"
              color={colors.textMuted}
              lineHeight="tight"
              style={styles.headerSubtitle}
            >
              {t('matchOrganizer.card.subtitlePrompt')}
            </Text>
          </View>
        </View>

        <View style={styles.options}>
          {metadata.options.map((option, index) => {
            const voters = votersByOption.get(index) ?? new Set<string>();
            const hasVoted = currentUserId ? voters.has(currentUserId) : false;
            const isMutual = participants.length > 0 && participants.every(p => voters.has(p));
            const start = new Date(option.slot_start);
            const dateLabel = friendlyDate(start);
            const timeLabel = formatTimeOfDay(start, locale);
            const priceLabel = formatPrice(option.price_cents);
            const courtCount = option.court_count ?? 0;
            const courtLabel = !option.court_confirmed
              ? t('matchOrganizer.tier.usuallyFree')
              : courtCount > 1
                ? t('matchOrganizer.tier.courtsMany').replace('{count}', String(courtCount))
                : courtCount === 1
                  ? t('matchOrganizer.tier.courtsOne')
                  : t('matchOrganizer.tier.courtAvailable');
            const isCreatingThis = creatingIndex === index;

            return (
              <View
                key={`${option.slot_start}-${option.facility_id}-${index}`}
                style={[
                  styles.option,
                  {
                    borderColor: isMutual ? accent : colors.border,
                    backgroundColor: isMutual ? `${accent}15` : colors.buttonInactive,
                  },
                ]}
              >
                <View style={styles.optionInfo}>
                  <Text size="sm" weight="semibold" color={colors.text}>
                    {dateLabel} · {timeLabel}
                  </Text>
                  {option.facility_name ? (
                    <Text size="xs" color={colors.textMuted} style={styles.optionFacility}>
                      {option.facility_name}
                    </Text>
                  ) : null}
                  <View
                    style={[
                      styles.courtPill,
                      {
                        backgroundColor: option.court_confirmed
                          ? statusColors.success.DEFAULT + '1A'
                          : colors.border + '66',
                      },
                    ]}
                  >
                    {option.court_confirmed ? (
                      <TennisCourtIcon
                        width={13}
                        height={13}
                        stroke={statusColors.success.DEFAULT}
                        style={styles.courtIcon}
                      />
                    ) : (
                      <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                    )}
                    <Text
                      size="xs"
                      weight="semibold"
                      color={
                        option.court_confirmed ? statusColors.success.DEFAULT : colors.textMuted
                      }
                    >
                      {courtLabel}
                      {option.court_confirmed && priceLabel ? ` · ${priceLabel}` : ''}
                    </Text>
                  </View>
                </View>

                {isMutual ? (
                  <Pressable
                    onPress={() => {
                      void handleCreate(option, index);
                    }}
                    disabled={createMatch.isPending || !isParticipant}
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
                    {voters.size > 0 ? (
                      <Text
                        size="xs"
                        weight="semibold"
                        color={hasVoted ? '#fff' : colors.textMuted}
                      >
                        {voters.size}
                      </Text>
                    ) : null}
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default MatchOrganizerCard;

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[2],
  },
  card: {
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
  },
  headerText: {
    flex: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: spacingPixels[1],
  },
  subtitle: {
    marginTop: 2,
  },
  headerSubtitle: {
    marginTop: spacingPixels[1],
  },
  options: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[1.5],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
  },
  optionInfo: {
    flex: 1,
    gap: 2,
  },
  optionFacility: {
    marginTop: 1,
  },
  courtPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacingPixels[1],
    borderRadius: 999,
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 3,
    marginTop: spacingPixels[1],
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
  cta: {
    marginTop: spacingPixels[3],
    alignSelf: 'flex-start',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: 999,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabelHidden: {
    opacity: 0,
  },
  ctaSpinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[2],
  },
  center: {
    textAlign: 'center',
  },
});
