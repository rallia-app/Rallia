/**
 * BookingDetailScreen
 * Full-screen detail view for a booking. Used for deep-link / push notification navigation.
 * Fetches the booking by ID and opens the BookingDetailSheet, or shows a loading/error state.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '@rallia/shared-components';
import { useBooking } from '@rallia/shared-hooks';
import { SheetManager } from 'react-native-actions-sheet';
import { spacingPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';
import type { RootStackScreenProps } from '#/navigation/types';

type Props = RootStackScreenProps<'BookingDetail'>;

export default function BookingDetailScreen({ route, navigation }: Props) {
  const { bookingId } = route.params;
  const { colors } = useThemeStyles();
  const { booking, isLoading, error } = useBooking(bookingId);

  useEffect(() => {
    if (booking) {
      // Open the detail sheet and go back to the previous screen
      SheetManager.show('booking-detail', {
        payload: { booking },
      });
      navigation.goBack();
    }
  }, [booking, navigation]);

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text size="base" color={colors.textMuted}>
          {error.message || 'Booking not found'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[4],
  },
});
