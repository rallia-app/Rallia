/**
 * BookingCard Component
 * Full-width card for the SectionList in MyBookingsScreen.
 * Shows facility name, court info, date/time, status badge, and price.
 * Tapping opens the BookingDetailSheet via SheetManager.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@rallia/shared-components';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { BookingWithDetails } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';
import { lightHaptic } from '#/utils/haptics';

import BookingStatusBadge from './BookingStatusBadge';

interface BookingCardProps {
  booking: BookingWithDetails;
}

/**
 * Format time string (HH:MM:SS -> HH:MM)
 */
function formatTime(time: string): string {
  return time.slice(0, 5);
}

/**
 * Format date to localized short date
 */
function formatDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format price in cents to currency display
 */
function formatPrice(priceCents: number, currency: string, freeLabel: string): string {
  if (priceCents === 0) return freeLabel;
  const amount = (priceCents / 100).toFixed(2);
  return `$${amount} ${currency.toUpperCase()}`;
}

export default function BookingCard({ booking }: BookingCardProps) {
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
  const dateLabel = formatDate(booking.booking_date, locale);
  const timeLabel = `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`;
  const priceLabel = formatPrice(booking.price_cents, booking.currency, t('myBookings.card.free'));

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
      accessibilityLabel={`${facilityName} ${courtLabel} ${dateLabel} ${timeLabel}`}
    >
      {/* Top row: facility name + status badge */}
      <View style={styles.topRow}>
        <Text
          size="base"
          weight="semibold"
          color={colors.text}
          style={styles.facilityName}
          numberOfLines={1}
        >
          {facilityName}
        </Text>
        <BookingStatusBadge status={booking.status} />
      </View>

      {/* Court info */}
      <View style={styles.infoRow}>
        <Ionicons name="tennisball-outline" size={14} color={colors.textMuted} />
        <Text size="sm" color={colors.textMuted} style={styles.infoText}>
          {courtLabel}
        </Text>
      </View>

      {/* Date & time row */}
      <View style={styles.infoRow}>
        <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
        <Text size="sm" color={colors.textMuted} style={styles.infoText}>
          {dateLabel}
        </Text>
        <Ionicons name="time-outline" size={14} color={colors.textMuted} style={styles.timeIcon} />
        <Text size="sm" color={colors.textMuted} style={styles.infoText}>
          {timeLabel}
        </Text>
      </View>

      {/* Price row */}
      <View style={styles.infoRow}>
        <Ionicons name="wallet-outline" size={14} color={colors.textMuted} />
        <Text size="sm" weight="medium" color={colors.text} style={styles.infoText}>
          {priceLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  facilityName: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  infoText: {
    marginLeft: spacingPixels[2],
  },
  timeIcon: {
    marginLeft: spacingPixels[3],
  },
});
