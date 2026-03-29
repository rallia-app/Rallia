/**
 * BookingDetailSheet Component
 * A react-native-actions-sheet bottom sheet showing full booking details.
 * Registered in sheets.tsx as 'booking-detail'.
 * Opened via SheetManager.show('booking-detail', { payload: { booking } }).
 */

import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles, useTranslation } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { BookingWithDetails } from '@rallia/shared-services';
import { lightHaptic } from '../../../utils/haptics';
import BookingStatusBadge from './BookingStatusBadge';
import CancelBookingModal from './CancelBookingModal';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../navigation/types';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

function formatTime(time: string): string {
  return time.slice(0, 5);
}

function formatDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatShortDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatPrice(priceCents: number, currency: string, freeLabel: string): string {
  if (priceCents === 0) return freeLabel;
  const amount = (priceCents / 100).toFixed(2);
  return `$${amount} ${currency.toUpperCase()}`;
}

function calculateDurationMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function isCancellable(booking: BookingWithDetails): boolean {
  const cancellableStatuses = ['confirmed', 'pending', 'awaiting_approval'];
  if (!cancellableStatuses.includes(booking.status)) return false;

  const bookingDateTime = new Date(`${booking.booking_date}T${booking.start_time}`);
  return bookingDateTime > new Date();
}

export function BookingDetailActionSheet(props: SheetProps<'booking-detail'>) {
  const booking = props.payload?.booking as BookingWithDetails | undefined;
  const { colors } = useThemeStyles();
  const { t, locale } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const [showCancelModal, setShowCancelModal] = useState(false);

  const handleClose = useCallback(() => {
    SheetManager.hide('booking-detail');
  }, []);

  const handleViewFacility = useCallback(() => {
    if (!booking?.court?.facility) return;
    lightHaptic();
    handleClose();
    // Navigate to facility detail; returnTo so back from FacilityDetail returns to My Bookings
    navigation.navigate('Main', {
      screen: 'Courts',
      params: {
        screen: 'FacilityDetail',
        params: { facilityId: booking.court.facility.id, returnTo: 'MyBookings' },
      },
    });
  }, [booking, handleClose, navigation]);

  const handleCopyBookingId = useCallback(async () => {
    if (!booking) return;
    lightHaptic();
    await Clipboard.setStringAsync(booking.id);
  }, [booking]);

  const handleCancelPress = useCallback(() => {
    lightHaptic();
    setShowCancelModal(true);
  }, []);

  const handleCancelled = useCallback(() => {
    setShowCancelModal(false);
    handleClose();
  }, [handleClose]);

  const canCancel = useMemo(() => (booking ? isCancellable(booking) : false), [booking]);

  if (!booking) return null;

  const facilityName = booking.court?.facility?.name ?? '';
  const facilityAddress = [booking.court?.facility?.city].filter(Boolean).join(', ');
  const courtLabel = booking.court?.court_number
    ? `${t('myBookings.card.court')} ${booking.court.court_number}`
    : (booking.court?.name ?? '');
  const dateLabel = formatDate(booking.booking_date, locale);
  const timeLabel = `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`;
  const duration = calculateDurationMinutes(booking.start_time, booking.end_time);
  const priceLabel = formatPrice(booking.price_cents, booking.currency, t('myBookings.card.free'));

  return (
    <ActionSheet
      id={props.sheetId}
      gestureEnabled
      containerStyle={[styles.sheet, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header - aligned with MatchDetailSheet */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text size="xl" weight="bold" color={colors.text}>
          {t('myBookings.detail.title')}
        </Text>
        <TouchableOpacity
          onPress={handleClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.closeButton}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={24} color={colors.iconMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Location Section - Tappable to facility */}
        <TouchableOpacity
          style={[styles.section, { borderBottomColor: colors.border }]}
          onPress={handleViewFacility}
          activeOpacity={0.7}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="location-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('myBookings.detail.facilityInfo')}
            </Text>
          </View>
          <View style={styles.locationRow}>
            <View style={[styles.infoRow, { flex: 1, minWidth: 0 }]}>
              <View style={styles.infoContent}>
                <Text size="base" color={colors.text}>
                  {facilityName || '—'}
                </Text>
                {facilityAddress ? (
                  <Text size="sm" color={colors.textMuted} style={styles.addressText}>
                    {facilityAddress}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.locationChevron}>
              <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
            </View>
          </View>
        </TouchableOpacity>

        {/* Court Section */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="tennisball-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('myBookings.detail.court')}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoContent}>
              <Text size="base" color={colors.text}>
                {courtLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* Date Section */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="calendar-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('myBookings.detail.date')}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoContent}>
              <Text size="base" color={colors.text}>
                {dateLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* Time Section */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="time-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('myBookings.detail.time')}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoContent}>
              <View style={styles.timeRow}>
                <Text size="base" color={colors.text}>
                  {timeLabel}
                </Text>
                <View style={[styles.durationBadge, { backgroundColor: colors.background }]}>
                  <Text size="xs" weight="medium" color={colors.textMuted}>
                    {t('myBookings.card.duration', { minutes: duration })}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Price Section */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="wallet-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('myBookings.detail.price')}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoContent}>
              <Text size="base" color={colors.text}>
                {priceLabel}
              </Text>
              {booking.payment_status && (
                <Text size="sm" color={colors.textMuted} style={styles.addressText}>
                  {t(
                    `myBookings.detail.payment${booking.payment_status.charAt(0).toUpperCase() + booking.payment_status.slice(1)}` as TranslationKey
                  )}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Status Section */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="information-circle-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('myBookings.detail.status')}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoContent}>
              <BookingStatusBadge status={booking.status} size="md" />
            </View>
          </View>
        </View>

        {/* Notes Section */}
        {booking.notes && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="chatbubble-outline" size={20} color={colors.iconMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('myBookings.detail.notes')}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.infoContent}>
                <Text size="sm" color={colors.text}>
                  {booking.notes}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Booking ID Section - Tappable to copy */}
        <TouchableOpacity
          style={[styles.section, { borderBottomColor: colors.border }]}
          onPress={handleCopyBookingId}
          activeOpacity={0.7}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="copy-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('myBookings.detail.bookingId')}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoContent}>
              <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                {booking.id}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Created at Section */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="create-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('myBookings.detail.createdAt')}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoContent}>
              <Text size="sm" color={colors.textMuted}>
                {formatShortDate(booking.created_at.split('T')[0], locale)}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Footer actions - aligned with MatchDetailSheet stickyFooter (same padding + safe area bottom) */}
      <View
        style={[
          styles.footer,
          {
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + spacingPixels[4],
          },
        ]}
      >
        {canCancel && (
          <TouchableOpacity
            style={[styles.cancelButton, { backgroundColor: colors.error }]}
            onPress={handleCancelPress}
            activeOpacity={0.8}
          >
            <Ionicons name="close-circle-outline" size={18} color="#fff" />
            <Text size="base" weight="semibold" color="#fff" style={styles.footerButtonText}>
              {t('myBookings.cancelBooking')}
            </Text>
          </TouchableOpacity>
        )}

        {/* Close sheet button */}
        <TouchableOpacity
          style={[styles.footerCloseButton, { backgroundColor: colors.background }]}
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <Text size="base" weight="semibold" color={colors.textMuted}>
            {t('common.close')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Cancel booking modal */}
      {showCancelModal && (
        <CancelBookingModal
          visible={showCancelModal}
          booking={booking}
          onClose={() => setShowCancelModal(false)}
          onCancelled={handleCancelled}
        />
      )}
    </ActionSheet>
  );
}

const FOOTER_BUTTON_HEIGHT = 48;

const styles = StyleSheet.create({
  // Sheet container
  sheet: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  // Header - same padding and border as MatchDetailSheet
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: spacingPixels[4],
  },
  // Sections - same as MatchDetailSheet (padding 5 horizontal, 4 vertical, hairline)
  section: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    marginLeft: spacingPixels[2],
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationChevron: {
    marginLeft: spacingPixels[2],
    marginRight: spacingPixels[1],
    flexShrink: 0,
  },
  // Info rows - same as MatchDetailSheet infoRow / infoContent
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoIconContainer: {
    width: spacingPixels[8],
    alignItems: 'center',
    paddingTop: spacingPixels[0.5],
  },
  infoContent: {
    flex: 1,
  },
  addressText: {
    marginTop: spacingPixels[1],
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  durationBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
  },
  // Footer - same as MatchDetailSheet stickyFooter; paddingBottom is overridden with safe area in component
  footer: {
    flexDirection: 'row',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    gap: spacingPixels[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minWidth: 0,
    height: FOOTER_BUTTON_HEIGHT,
    borderRadius: radiusPixels.lg,
  },
  footerCloseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minWidth: 0,
    height: FOOTER_BUTTON_HEIGHT,
    borderRadius: radiusPixels.lg,
  },
  iconButton: {
    width: FOOTER_BUTTON_HEIGHT,
    height: FOOTER_BUTTON_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  footerButtonText: {
    marginLeft: spacingPixels[2],
  },
});
