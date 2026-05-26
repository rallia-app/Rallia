/**
 * BookingStatusBadge Component
 * Displays the booking status with semantic colors and i18n labels.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@rallia/shared-components';
import type { TranslationKey } from '@rallia/shared-translations';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import type { BookingStatus } from '@rallia/shared-services';

import { useTranslation, useThemeStyles } from '#/hooks';

interface BookingStatusBadgeProps {
  status: BookingStatus;
  size?: 'sm' | 'md';
}

/**
 * Map booking status to semantic colors
 */
function getStatusColors(status: BookingStatus, isDark: boolean): { bg: string; text: string } {
  switch (status) {
    case 'confirmed':
      return {
        bg: isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
        text: isDark ? '#4ade80' : '#16a34a',
      };
    case 'pending':
    case 'awaiting_approval':
      return {
        bg: isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.1)',
        text: isDark ? '#fbbf24' : '#d97706',
      };
    case 'cancelled':
      return {
        bg: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)',
        text: isDark ? '#f87171' : '#dc2626',
      };
    case 'completed':
      return {
        bg: isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.1)',
        text: isDark ? '#94a3b8' : '#64748b',
      };
    case 'no_show':
      return {
        bg: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)',
        text: isDark ? '#f87171' : '#dc2626',
      };
    default:
      return {
        bg: isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.1)',
        text: isDark ? '#94a3b8' : '#64748b',
      };
  }
}

/**
 * Map booking status to i18n key
 */
function getStatusLabelKey(status: BookingStatus): TranslationKey {
  const map: Record<BookingStatus, TranslationKey> = {
    confirmed: 'myBookings.status.confirmed',
    pending: 'myBookings.status.pending',
    awaiting_approval: 'myBookings.status.awaitingApproval',
    cancelled: 'myBookings.status.cancelled',
    completed: 'myBookings.status.completed',
    no_show: 'myBookings.status.noShow',
  };
  return map[status] ?? 'myBookings.status.pending';
}

export default function BookingStatusBadge({ status, size = 'sm' }: BookingStatusBadgeProps) {
  const { t } = useTranslation();
  const { isDark } = useThemeStyles();
  const { bg, text } = getStatusColors(status, isDark);

  return (
    <View style={[styles.badge, { backgroundColor: bg }, size === 'md' && styles.badgeMd]}>
      <Text size={size === 'md' ? 'sm' : 'xs'} weight="semibold" color={text}>
        {t(getStatusLabelKey(status))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
    alignSelf: 'flex-start',
  },
  badgeMd: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
  },
});
