/**
 * CourtSystemMessageCard
 *
 * Renders the "Rallia" system messages posted into a match chat when the match
 * fills up (see migration 20260605120000):
 *  - 'court_booking_prompt': the match is full but no court is reserved. A
 *    compact CTA that opens the match-detail sheet, where MatchAvailableCourtsSection
 *    lists the bookable courts (and nearby fallback). The chat card is the shared
 *    status board; the match-detail card is the action surface.
 *  - 'court_booked': a court was reserved — a confirmation card.
 *
 * Falls back to the message's plain text if metadata is missing.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, status as statusColors } from '@rallia/design-system';
import { getMatchWithDetails } from '@rallia/shared-services';
import type {
  CourtBookedMetadata,
  CourtBookingPromptMetadata,
  MessageWithSender,
} from '@rallia/shared-services';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { useMatchDetailSheet } from '#/context/MatchDetailSheetContext';
import { useTranslation, useThemeStyles } from '#/hooks';

interface CourtSystemMessageCardProps {
  message: MessageWithSender;
}

export function CourtSystemMessageCard({ message }: CourtSystemMessageCardProps) {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();
  const { openSheet } = useMatchDetailSheet();
  const [isOpening, setIsOpening] = useState(false);

  const isPrompt = message.message_type === 'court_booking_prompt';
  const metadata = (message.metadata ?? null) as
    | CourtBookingPromptMetadata
    | CourtBookedMetadata
    | null;
  const matchId = metadata?.match_id ?? null;
  const facilityName = metadata?.facility_name ?? null;
  const courtLabel = (metadata as CourtBookedMetadata | null)?.court_label ?? null;

  const handleOpenMatch = useCallback(async () => {
    if (!matchId || isOpening) return;
    setIsOpening(true);
    try {
      const match = await getMatchWithDetails(matchId);
      if (match) openSheet(match as MatchDetailData);
    } finally {
      setIsOpening(false);
    }
  }, [matchId, isOpening, openSheet]);

  // No structured payload (shouldn't happen) — degrade to plain text.
  if (!matchId) {
    return (
      <View style={styles.fallback}>
        <Text size="sm" color={colors.textMuted} style={styles.center}>
          {message.content}
        </Text>
      </View>
    );
  }

  const accent = isPrompt ? colors.primary : statusColors.success.DEFAULT;
  const title = isPrompt
    ? t('matchChat.courtPrompt.title')
    : t('matchChat.courtBooked.title').replace(
        '{court}',
        courtLabel ?? t('matchChat.courtFallback')
      );
  const subtitle = facilityName
    ? (isPrompt
        ? t('matchChat.courtPrompt.subtitle')
        : t('matchChat.courtBooked.subtitle')
      ).replace('{facility}', facilityName)
    : null;

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
        <View style={[styles.iconCircle, { backgroundColor: accent + '1A' }]}>
          <Ionicons
            name={isPrompt ? 'tennisball-outline' : 'checkmark-circle'}
            size={20}
            color={accent}
          />
        </View>

        <View style={styles.body}>
          <Text size="sm" weight="semibold" color={colors.text}>
            {title}
          </Text>
          {subtitle ? (
            <Text size="xs" color={colors.textMuted} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}

          {isPrompt ? (
            <View style={[styles.cta, { backgroundColor: accent }]}>
              {/* Label stays laid out (reserving the button's size) while the
                  spinner overlays it, so dimensions don't change when loading. */}
              <Text
                size="sm"
                weight="semibold"
                color="#fff"
                style={isOpening ? styles.ctaLabelHidden : undefined}
              >
                {t('matchChat.courtPrompt.cta')}
              </Text>
              {isOpening ? (
                <View style={styles.ctaSpinner} pointerEvents="none">
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

export default CourtSystemMessageCard;

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[2],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
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
