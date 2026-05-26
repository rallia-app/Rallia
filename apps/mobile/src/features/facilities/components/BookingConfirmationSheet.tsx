/**
 * BookingConfirmationSheet Component
 * Shown when user returns to the app after opening an external booking URL.
 * Asks "Did you book?" and if confirmed, opens the match creation wizard
 * pre-filled with the booking data.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';
import { useSport } from '#/context';
import { SportIcon } from '#/components/SportIcon';

export function BookingConfirmationActionSheet({ payload }: SheetProps<'booking-confirmation'>) {
  const facilityName = payload?.facilityName;
  const slotTime = payload?.slotTime;
  const slotDate = payload?.slotDate;
  const onConfirm = payload?.onConfirm;
  const onDecline = payload?.onDecline;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { selectedSport } = useSport();

  const handleConfirm = useCallback(() => {
    mediumHaptic();
    SheetManager.hide('booking-confirmation');
    // Small delay to let the sheet dismiss before opening the wizard sheet
    setTimeout(() => {
      onConfirm?.();
    }, 300);
  }, [onConfirm]);

  const handleDecline = useCallback(() => {
    lightHaptic();
    SheetManager.hide('booking-confirmation');
    onDecline?.();
  }, [onDecline]);

  if (!facilityName) return null;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetContainer, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Icon */}
      <View style={styles.iconContainer}>
        <View style={[styles.iconCircle, { backgroundColor: primary[500] + '15' }]}>
          <SportIcon sportName={selectedSport?.name ?? 'tennis'} size={32} color={colors.primary} />
        </View>
      </View>

      {/* Title */}
      <Text weight="bold" size="xl" style={[styles.title, { color: colors.text }]}>
        {t('booking.confirmation.title')}
      </Text>

      {/* Subtitle */}
      <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
        {t('booking.confirmation.subtitle')}
      </Text>

      {/* Booking details */}
      <View
        style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={styles.detailRow}>
          <Ionicons name="location" size={16} color={colors.primary} />
          <Text size="sm" weight="medium" color={colors.text} style={styles.detailText}>
            {facilityName}
          </Text>
        </View>
        {slotDate && (
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.detailText}>
              {slotDate}
            </Text>
          </View>
        )}
        {slotTime && (
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={16} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.detailText}>
              {slotTime}
            </Text>
          </View>
        )}
      </View>

      {/* Perks */}
      <View style={styles.perksContainer}>
        <View style={styles.perkRow}>
          <View style={[styles.perkIcon, { backgroundColor: primary[500] + '15' }]}>
            <Ionicons name="eye-outline" size={16} color={colors.primary} />
          </View>
          <Text size="sm" color={colors.text} style={styles.perkText}>
            {t('booking.confirmation.perkVisibility')}
          </Text>
        </View>
        <View style={styles.perkRow}>
          <View style={[styles.perkIcon, { backgroundColor: primary[500] + '15' }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
          </View>
          <Text size="sm" color={colors.text} style={styles.perkText}>
            {t('booking.confirmation.perkApproval')}
          </Text>
        </View>
        <View style={styles.perkRow}>
          <View style={[styles.perkIcon, { backgroundColor: primary[500] + '15' }]}>
            <Ionicons name="person-add-outline" size={16} color={colors.primary} />
          </View>
          <Text size="sm" color={colors.text} style={styles.perkText}>
            {t('booking.confirmation.perkInvite')}
          </Text>
        </View>
      </View>

      {/* Buttons */}
      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={[styles.confirmButton, { backgroundColor: colors.primary }]}
          onPress={handleConfirm}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle-outline" size={20} color="#fff" />
          <Text size="lg" weight="semibold" color="#fff">
            {t('booking.confirmation.confirm')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleDecline} activeOpacity={0.6} style={styles.declineButton}>
          <Text size="sm" color={colors.textMuted} style={styles.declineText}>
            {t('booking.confirmation.decline')}
          </Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

export default BookingConfirmationActionSheet;

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
  perksContainer: {
    marginHorizontal: spacingPixels[5],
    marginTop: spacingPixels[4],
    gap: spacingPixels[3],
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  perkIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  perkText: {
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
