/**
 * MatchBookingConfirmationSheet
 *
 * Shown when the host returns to the app after opening an external court
 * booking URL from a match's available-courts section. Asks "Did you book?"
 * and, on confirm, runs the passed callback which links the booked court to
 * the existing match.
 *
 * Implemented as a SheetManager-registered ActionSheet (NOT a React Native
 * <Modal>) so it stacks on top of the still-open match-detail sheet. A bare
 * <Modal> rendered from the app-level provider lands *behind* the actions sheet
 * and silently blocks touches — which is exactly the bug this replaces.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';

export function MatchBookingConfirmationActionSheet({
  payload,
}: SheetProps<'match-booking-confirmation'>) {
  const facilityName = payload?.facilityName;
  const courtLabel = payload?.courtLabel;
  const dateLabel = payload?.dateLabel;
  const timeLabel = payload?.timeLabel;
  const priceLabel = payload?.priceLabel;
  const onConfirm = payload?.onConfirm;
  const onDecline = payload?.onDecline;
  const onDismiss = payload?.onDismiss;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (isConfirming) return;
    void mediumHaptic();
    setIsConfirming(true);
    try {
      // The match update runs here; the spinner stays up until it resolves.
      await onConfirm?.();
    } finally {
      setIsConfirming(false);
      void SheetManager.hide('match-booking-confirmation');
    }
  }, [isConfirming, onConfirm]);

  const handleDecline = useCallback(() => {
    if (isConfirming) return;
    void lightHaptic();
    void SheetManager.hide('match-booking-confirmation');
    onDecline?.();
  }, [isConfirming, onDecline]);

  if (!facilityName) return null;

  return (
    <ActionSheet
      gestureEnabled={!isConfirming}
      closeOnPressBack={!isConfirming}
      // Fires on EVERY close — including swipe-down and backdrop tap — so the
      // provider always resets its pending-booking guard. Without this, a
      // gesture-dismiss would leave the guard stuck and block the next redirect.
      onClose={() => onDismiss?.()}
      containerStyle={[styles.sheetContainer, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.iconContainer}>
        <View style={[styles.iconCircle, { backgroundColor: primary[500] + '15' }]}>
          <Ionicons name="checkmark-done-outline" size={32} color={colors.primary} />
        </View>
      </View>

      <Text weight="bold" size="xl" style={[styles.title, { color: colors.text }]}>
        {t('booking.confirmation.title')}
      </Text>

      <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
        {t('matchDetail.bookingConfirmation.message')}
      </Text>

      <View
        style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={styles.detailRow}>
          <Ionicons name="location" size={16} color={colors.primary} />
          <Text size="sm" weight="medium" color={colors.text} style={styles.detailText}>
            {facilityName}
          </Text>
        </View>

        {courtLabel ? (
          <View style={styles.detailRow}>
            <Ionicons name="tennisball-outline" size={16} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.detailText}>
              {courtLabel}
            </Text>
          </View>
        ) : null}

        {dateLabel ? (
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.detailText}>
              {dateLabel}
            </Text>
          </View>
        ) : null}

        {timeLabel ? (
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={16} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.detailText}>
              {timeLabel}
            </Text>
          </View>
        ) : null}

        {priceLabel ? (
          <View style={styles.detailRow}>
            <Ionicons name="pricetag-outline" size={16} color={colors.textMuted} />
            <Text size="sm" weight="medium" color={colors.text} style={styles.detailText}>
              {priceLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={[
            styles.confirmButton,
            { backgroundColor: colors.primary, opacity: isConfirming ? 0.7 : 1 },
          ]}
          onPress={() => {
            void handleConfirm();
          }}
          activeOpacity={0.8}
          disabled={isConfirming}
        >
          {isConfirming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text size="lg" weight="semibold" color="#fff">
                {t('matchDetail.bookingConfirmation.confirm')}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleDecline}
          activeOpacity={0.6}
          style={styles.declineButton}
          disabled={isConfirming}
        >
          <Text size="sm" color={colors.textMuted} style={styles.declineText}>
            {t('matchDetail.bookingConfirmation.decline')}
          </Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

export default MatchBookingConfirmationActionSheet;

const styles = StyleSheet.create({
  sheetContainer: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    paddingTop: spacingPixels[4],
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    marginTop: spacingPixels[3],
    paddingHorizontal: spacingPixels[5],
  },
  subtitle: {
    textAlign: 'center',
    marginTop: spacingPixels[1],
    paddingHorizontal: spacingPixels[6],
  },
  detailsCard: {
    marginHorizontal: spacingPixels[5],
    marginTop: spacingPixels[4],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  detailText: {
    flex: 1,
  },
  buttonsContainer: {
    padding: spacingPixels[5],
    gap: spacingPixels[3],
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  declineButton: {
    paddingVertical: spacingPixels[3],
  },
  declineText: {
    textAlign: 'center',
  },
});
