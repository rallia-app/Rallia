/**
 * MyBookingCard Component
 * Compact card for the horizontal "My Bookings" scroll in FacilitiesDirectory.
 * Shows facility name, court number, abbreviated date, time range, and status badge.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@rallia/shared-components';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { BookingWithDetails } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';
import { lightHaptic } from '#/utils/haptics';

import BookingStatusBadge from './BookingStatusBadge';

interface MyBookingCardProps {
  booking: BookingWithDetails;
}

const CARD_WIDTH = 160;

function formatTime(time: string): string {
  return time.slice(0, 5);
}

function formatDateShort(dateStr: string, locale: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function MyBookingCard({ booking }: MyBookingCardProps) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();

  const handlePress = useCallback(() => {
    lightHaptic();
    SheetManager.show('booking-detail', {
      payload: { booking },
    });
  }, [booking]);

  const facilityName = booking.court?.facility?.name ?? '';
  const courtLabel = booking.court?.court_number
    ? `${t('myBookings.card.court')} ${booking.court.court_number}`
    : (booking.court?.name ?? '');

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.border,
          borderWidth: 1,
          shadowColor: isDark ? 'transparent' : '#000',
        },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${facilityName} ${courtLabel}`}
    >
      {/* Facility name */}
      <Text size="sm" weight="semibold" color={colors.text} numberOfLines={1}>
        {facilityName}
      </Text>

      {/* Court */}
      <View style={styles.row}>
        <Ionicons name="tennisball-outline" size={12} color={colors.textMuted} />
        <Text size="xs" color={colors.textMuted} style={styles.rowText} numberOfLines={1}>
          {courtLabel}
        </Text>
      </View>

      {/* Date */}
      <View style={styles.row}>
        <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
        <Text size="xs" color={colors.textMuted} style={styles.rowText}>
          {formatDateShort(booking.booking_date, locale)}
        </Text>
      </View>

      {/* Time */}
      <View style={styles.row}>
        <Ionicons name="time-outline" size={12} color={colors.textMuted} />
        <Text size="xs" color={colors.textMuted} style={styles.rowText}>
          {formatTime(booking.start_time)} – {formatTime(booking.end_time)}
        </Text>
      </View>

      {/* Status badge */}
      <View style={styles.badgeRow}>
        <BookingStatusBadge status={booking.status} size="sm" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
    gap: spacingPixels[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: {
    marginLeft: spacingPixels[1],
    flex: 1,
  },
  badgeRow: {
    marginTop: spacingPixels[1],
  },
});
