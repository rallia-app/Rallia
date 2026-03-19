/**
 * CancelBookingModal Component
 * Confirmation modal for cancelling a booking.
 * Shows refund information based on cancellation policy, reason selector, and confirmation buttons.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Text, Button } from '@rallia/shared-components';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useThemeStyles, useTranslation } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { BookingWithDetails, PlayerBookingsPage } from '@rallia/shared-services';
import { calculateRefundAmount } from '@rallia/shared-services';
import { useCancelBooking, useCancellationPolicy, bookingKeys } from '@rallia/shared-hooks';
import { lightHaptic, mediumHaptic } from '../../../utils/haptics';
import type { CancellationReasonEnum } from '@rallia/shared-types';

interface CancelBookingModalProps {
  visible: boolean;
  booking: BookingWithDetails;
  onClose: () => void;
  onCancelled: () => void;
}

interface CancellationReason {
  key: CancellationReasonEnum;
  labelKey: TranslationKey;
  icon: keyof typeof Ionicons.glyphMap;
}

const CANCELLATION_REASONS: CancellationReason[] = [
  { key: 'weather', labelKey: 'myBookings.cancel.reasons.weather', icon: 'cloud-outline' as const },
  {
    key: 'court_unavailable',
    labelKey: 'myBookings.cancel.reasons.courtUnavailable',
    icon: 'close-circle-outline' as const,
  },
  {
    key: 'emergency',
    labelKey: 'myBookings.cancel.reasons.emergency',
    icon: 'alert-circle-outline' as const,
  },
  {
    key: 'other',
    labelKey: 'myBookings.cancel.reasons.other',
    icon: 'chatbubble-outline' as const,
  },
];

function getHoursUntilBooking(bookingDate: string, startTime: string): number {
  const bookingDateTime = new Date(`${bookingDate}T${startTime}`);
  const now = new Date();
  return (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export default function CancelBookingModal({
  visible,
  booking,
  onClose,
  onCancelled,
}: CancelBookingModalProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  // Get cancellation policy
  const organizationId = booking.organization_id;
  const { policy } = useCancellationPolicy(organizationId, { enabled: visible });

  // Calculate refund
  const refundInfo = useMemo(() => {
    if (!policy) return null;
    const hours = getHoursUntilBooking(booking.booking_date, booking.start_time);
    return calculateRefundAmount(booking.price_cents, hours, policy);
  }, [policy, booking]);

  const queryClient = useQueryClient();

  // Optimistic update: remove booking from all list caches immediately
  const applyOptimisticUpdate = useCallback(() => {
    // Update infinite query caches (player-tab queries)
    queryClient.setQueriesData<{ pages: PlayerBookingsPage[]; pageParams: unknown[] }>(
      { queryKey: [...bookingKeys.lists(), 'player-tab'] },
      old => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map(page => ({
            ...page,
            bookings: page.bookings.filter(b => b.id !== booking.id),
          })),
        };
      }
    );

    // Update simple list caches (upcoming preview)
    queryClient.setQueriesData<BookingWithDetails[]>({ queryKey: bookingKeys.lists() }, old => {
      if (!old || !Array.isArray(old)) return old;
      return old.filter(b => b.id !== booking.id);
    });
  }, [queryClient, booking.id]);

  // Cancel mutation
  const { cancelBooking, isCancelling } = useCancelBooking({
    onSuccess: () => {
      mediumHaptic();
      applyOptimisticUpdate();
      // Ensure FacilitiesDirectory "My Bookings" section (useUpcomingBookings) refetches
      queryClient.invalidateQueries({ queryKey: bookingKeys.lists() });
      onCancelled();
    },
    onError: () => {
      // Error handled by toast in parent
    },
  });

  const handleCancel = () => {
    lightHaptic();
    cancelBooking({
      bookingId: booking.id,
      reason: selectedReason ?? undefined,
    });
  };

  const getRefundMessage = (): string => {
    if (!refundInfo) return '';
    if (refundInfo.refundPercent === 100) {
      return t('myBookings.cancel.refundInfo.full');
    }
    if (refundInfo.refundPercent > 0) {
      return t('myBookings.cancel.refundInfo.partial', {
        percent: refundInfo.refundPercent,
      });
    }
    return t('myBookings.cancel.refundInfo.none');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.container,
            {
              backgroundColor: colors.cardBackground,
              shadowColor: isDark ? 'transparent' : '#000',
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Ionicons name="alert-circle" size={32} color={colors.error} />
            <Text size="lg" weight="bold" color={colors.text} style={styles.headerTitle}>
              {t('myBookings.cancel.title')}
            </Text>
          </View>

          {/* Message */}
          <Text size="sm" color={colors.textMuted} style={styles.message}>
            {t('myBookings.cancel.confirmMessage')}
          </Text>

          {/* Refund info */}
          {refundInfo && booking.price_cents > 0 && (
            <View
              style={[
                styles.refundBox,
                {
                  backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.08)',
                  borderColor: isDark ? 'rgba(245, 158, 11, 0.2)' : 'rgba(245, 158, 11, 0.15)',
                },
              ]}
            >
              <Ionicons name="wallet-outline" size={18} color={isDark ? '#fbbf24' : '#d97706'} />
              <Text
                size="sm"
                weight="medium"
                color={isDark ? '#fbbf24' : '#d97706'}
                style={styles.refundText}
              >
                {getRefundMessage()}
              </Text>
            </View>
          )}

          {/* Reason selector */}
          <Text size="sm" weight="semibold" color={colors.text} style={styles.reasonLabel}>
            {t('myBookings.cancel.selectReason')}
          </Text>
          <View style={styles.reasonList}>
            {CANCELLATION_REASONS.map(reason => {
              const isSelected = selectedReason === reason.key;
              return (
                <TouchableOpacity
                  key={reason.key}
                  style={[
                    styles.reasonItem,
                    {
                      backgroundColor: isSelected
                        ? isDark
                          ? 'rgba(239, 68, 68, 0.1)'
                          : 'rgba(239, 68, 68, 0.05)'
                        : isDark
                          ? colors.background
                          : colors.cardBackground,
                      borderColor: isSelected ? colors.error : colors.border,
                    },
                  ]}
                  onPress={() => {
                    lightHaptic();
                    setSelectedReason(isSelected ? null : reason.key);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={reason.icon}
                    size={18}
                    color={isSelected ? colors.error : colors.textMuted}
                  />
                  <Text
                    size="sm"
                    weight={isSelected ? 'semibold' : 'medium'}
                    color={isSelected ? colors.error : colors.text}
                    style={styles.reasonText}
                  >
                    {t(reason.labelKey)}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={18} color={colors.error} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              destructive
              loading={isCancelling}
              onPress={handleCancel}
              isDark={isDark}
            >
              {t('myBookings.cancel.cancelButton')}
            </Button>
            <Button
              variant="outline"
              size="lg"
              fullWidth
              disabled={isCancelling}
              onPress={onClose}
              isDark={isDark}
            >
              {t('myBookings.cancel.keepButton')}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[4],
  },
  container: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[5],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  headerTitle: {
    marginLeft: spacingPixels[2],
  },
  message: {
    marginBottom: spacingPixels[4],
    lineHeight: 20,
  },
  refundBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  refundText: {
    marginLeft: spacingPixels[2],
    flex: 1,
  },
  reasonLabel: {
    marginBottom: spacingPixels[2],
  },
  reasonList: {
    gap: spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  reasonText: {
    flex: 1,
    marginLeft: spacingPixels[2],
  },
  actions: {
    gap: spacingPixels[2],
  },
});
