/**
 * CourtSystemMessageCard
 *
 * Renders the "Rallia" system messages posted into a match chat when the match
 * fills up (see migration 20260605120000):
 *  - 'court_booking_prompt': the match is full but no court is reserved. A
 *    header plus a full-width CTA that opens the match-detail sheet, where
 *    MatchAvailableCourtsSection lists the bookable courts (and nearby
 *    fallback). The chat card is the shared status board; the match-detail
 *    card is the action surface.
 *  - 'court_booked': a court was reserved — the same compact confirmation band
 *    the Match Organizer uses for "Partie créée", so every "it happened" card
 *    in a chat reads the same way.
 *
 * Falls back to the message's plain text if metadata is missing. Skeleton and
 * styling come from ChatCardShell, shared with the Match Organizer card.
 */

import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@rallia/shared-components';
import { base, status as statusColors } from '@rallia/design-system';
import { getMatchWithDetails } from '@rallia/shared-services';
import type {
  CourtBookedMetadata,
  CourtBookingPromptMetadata,
  MessageWithSender,
} from '@rallia/shared-services';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { useMatchDetailSheet } from '#/context/MatchDetailSheetContext';
import { useTranslation, useThemeStyles } from '#/hooks';

import {
  ChatCardFallback,
  ChatCardHeader,
  ChatConfirmationBand,
  chatCardShell,
} from './ChatCardShell';

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
    return <ChatCardFallback text={message.content} colors={colors} />;
  }

  // A reserved court is a done deal: same confirmation band as "Partie créée".
  if (!isPrompt) {
    return (
      <ChatConfirmationBand
        accent={statusColors.success.DEFAULT}
        title={t('matchChat.courtBooked.title').replace(
          '{court}',
          courtLabel ?? t('matchChat.courtFallback')
        )}
        lines={[
          facilityName
            ? t('matchChat.courtBooked.subtitle').replace('{facility}', facilityName)
            : null,
        ]}
        onPress={() => {
          void handleOpenMatch();
        }}
        isOpening={isOpening}
        accessibilityLabel={t('matchChat.courtBooked.title').replace(
          '{court}',
          courtLabel ?? t('matchChat.courtFallback')
        )}
        colors={colors}
      />
    );
  }

  return (
    <View style={chatCardShell.wrapper}>
      <Pressable
        onPress={() => {
          void handleOpenMatch();
        }}
        style={[
          chatCardShell.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <ChatCardHeader
          icon="tennisball-outline"
          accent={colors.primary}
          title={t('matchChat.courtPrompt.title')}
          subtitle={
            facilityName
              ? t('matchChat.courtPrompt.subtitle').replace('{facility}', facilityName)
              : null
          }
          colors={colors}
        />
        <View style={chatCardShell.cardCta}>
          <Button
            variant="primary"
            size="sm"
            fullWidth
            loading={isOpening}
            onPress={() => {
              void handleOpenMatch();
            }}
            leftIcon={<Ionicons name="calendar-outline" size={16} color={base.white} />}
          >
            {t('matchChat.courtPrompt.cta')}
          </Button>
        </View>
      </Pressable>
    </View>
  );
}

export default CourtSystemMessageCard;
