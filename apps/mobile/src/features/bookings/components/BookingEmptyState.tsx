/**
 * BookingEmptyState Component
 * Shows filter-aware empty state messages for booking lists.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@rallia/shared-components';
import { Ionicons } from '@expo/vector-icons';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels } from '@rallia/design-system';
import type { BookingTab } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';

interface BookingEmptyStateProps {
  activeTab: BookingTab;
  currentStatusFilter: string;
}

/**
 * Map status filter to an icon
 */
function getFilterIcon(filter: string, tab: BookingTab): keyof typeof Ionicons.glyphMap {
  if (filter === 'all') {
    return tab === 'upcoming' ? 'calendar-outline' : 'time-outline';
  }
  switch (filter) {
    case 'confirmed':
      return 'checkmark-circle-outline';
    case 'pending':
      return 'hourglass-outline';
    case 'awaiting_approval':
      return 'time-outline';
    case 'completed':
      return 'checkmark-done-outline';
    case 'cancelled':
      return 'close-circle-outline';
    case 'no_show':
      return 'alert-circle-outline';
    default:
      return 'search-outline';
  }
}

/**
 * Map filter key to its i18n label key
 */
function getFilterLabelKey(filter: string): TranslationKey {
  const map: Record<string, TranslationKey> = {
    confirmed: 'myBookings.filters.confirmed',
    pending: 'myBookings.filters.pending',
    awaiting_approval: 'myBookings.filters.awaitingApproval',
    completed: 'myBookings.filters.completed',
    cancelled: 'myBookings.filters.cancelled',
    no_show: 'myBookings.filters.noShow',
  };
  return map[filter] ?? 'myBookings.filters.all';
}

export default function BookingEmptyState({
  activeTab,
  currentStatusFilter,
}: BookingEmptyStateProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const isFiltered = currentStatusFilter !== 'all';
  const icon = getFilterIcon(currentStatusFilter, activeTab);

  const getContent = () => {
    if (!isFiltered) {
      const emptyKey = activeTab === 'upcoming' ? 'emptyUpcoming' : 'emptyPast';
      return {
        title: t(`myBookings.${emptyKey}.title`),
        description: t(`myBookings.${emptyKey}.description`),
      };
    }
    return {
      title: t('myBookings.emptyFiltered.title'),
      description: t('myBookings.emptyFiltered.description', {
        filter: t(getFilterLabelKey(currentStatusFilter)),
      }),
    };
  };

  const { title, description } = getContent();

  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={64} color={colors.textMuted} />
      <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.title}>
        {title}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.description}>
        {description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
    paddingTop: spacingPixels[8],
    paddingBottom: spacingPixels[8],
  },
  title: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[2],
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    lineHeight: 20,
  },
});
