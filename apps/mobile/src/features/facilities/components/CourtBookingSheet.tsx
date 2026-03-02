/**
 * CourtBookingSheet Component
 * Bottom sheet for booking a local (org-managed) court slot.
 * Integrates with Stripe for payment.
 * UI follows UserProfile sheets (PlayerInformationOverlay, PlayerAvailabilitiesOverlay) for consistency.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { useStripe } from '@stripe/stripe-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import {
  courtAvailabilityKeys,
  useCreateBooking,
  type FormattedSlot,
  type CourtOption,
} from '@rallia/shared-hooks';
import type { Court } from '@rallia/shared-types';
import type { FacilityWithDetails } from '@rallia/shared-services';
import { Logger } from '@rallia/shared-services';
import { lightHaptic, mediumHaptic, selectionHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';

/**
 * Extended theme colors for the booking sheet
 */
interface ThemeColors {
  background: string;
  card: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryLight: string;
  border: string;
  iconMuted: string;
}

/**
 * Format price (already in dollars) to display string
 */
function formatPrice(price: number | undefined): string {
  if (price === undefined || price === 0) return 'Free';
  return `$${price.toFixed(2)}`;
}

/**
 * Convert 12-hour time format to 24-hour HH:MM:SS format
 * Examples: "2:00 PM" -> "14:00:00", "11:00 AM" -> "11:00:00"
 */
function convertTo24Hour(time12h: string): string {
  const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    // If already in 24-hour format or unrecognized, return as-is with seconds
    return time12h.includes(':') && time12h.length >= 5
      ? time12h.includes(':00:00')
        ? time12h
        : `${time12h}:00`
      : time12h;
  }

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
}

export function CourtBookingActionSheet({ payload }: SheetProps<'court-booking'>) {
  const facility = payload?.facility as FacilityWithDetails;
  const slot = payload?.slot as FormattedSlot;
  const courts = useMemo(() => (payload?.courts ?? []) as Court[], [payload?.courts]);
  const onSuccess = payload?.onSuccess as
    | ((data: { facilityId: string; courtId: string; courtNumber: number | null }) => void)
    | undefined;
  const onCreateGameFromBooking = payload?.onCreateGameFromBooking as
    | ((data: {
        facility: FacilityWithDetails;
        slot: FormattedSlot;
        facilityId: string;
        courtId: string;
        courtNumber: number | null;
      }) => void)
    | undefined;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { selectedSport } = useSport();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Booking mutation
  const { createBookingAsync, isCreating } = useCreateBooking({
    onError: error => {
      Logger.error('Booking creation failed', error);
    },
  });

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  // Hold booking result for success step "Create game" action
  const [lastBookingResult, setLastBookingResult] = useState<{
    facilityId: string;
    courtId: string;
    courtNumber: number | null;
  } | null>(null);

  // Success step animation (match MatchCreationWizard)
  const formOpacity = useSharedValue(1);
  const successOpacity = useSharedValue(0);
  const successScale = useSharedValue(0.8);

  // Extended theme colors matching MatchDetailSheet pattern
  const themeColors = useMemo<ThemeColors>(
    () => ({
      background: colors.background,
      card: colors.cardBackground,
      text: colors.text,
      textMuted: colors.textMuted,
      primary: colors.primary,
      primaryLight: isDark ? primary[900] : primary[50],
      border: colors.border,
      iconMuted: colors.textMuted,
    }),
    [colors, isDark]
  );

  // Handle sheet dismiss with haptic
  const handleClose = useCallback(() => {
    selectionHaptic();
    SheetManager.hide('court-booking');
    setBookingSuccess(false);
    setLastBookingResult(null);
  }, []);

  // Success step: "Create game" – call onSuccess or onCreateGameFromBooking then close
  const handleCreateGame = useCallback(() => {
    if (!lastBookingResult) return;
    lightHaptic();
    if (onSuccess) {
      onSuccess(lastBookingResult);
    } else if (onCreateGameFromBooking && facility && slot) {
      onCreateGameFromBooking({
        facility,
        slot,
        ...lastBookingResult,
      });
    }
    SheetManager.hide('court-booking');
    setBookingSuccess(false);
    setLastBookingResult(null);
  }, [lastBookingResult, onSuccess, onCreateGameFromBooking, facility, slot]);

  // Success step: "Done" – just close
  const handleDone = useCallback(() => {
    selectionHaptic();
    SheetManager.hide('court-booking');
    setBookingSuccess(false);
    setLastBookingResult(null);
  }, []);

  // Trigger success animation when bookingSuccess becomes true
  useEffect(() => {
    if (bookingSuccess) {
      formOpacity.value = withTiming(0, { duration: 150 });
      successOpacity.value = withTiming(1, { duration: 300 });
      successScale.value = withSpring(1, { damping: 80, stiffness: 400 });
    } else {
      formOpacity.value = withTiming(1);
      successOpacity.value = withTiming(0);
      successScale.value = 0.8;
    }
  }, [bookingSuccess, formOpacity, successOpacity, successScale]);

  const successAnimatedStyle = useAnimatedStyle(() => ({
    opacity: successOpacity.value,
    transform: [{ scale: successScale.value }],
  }));

  // Get available court options from the slot (memoized to prevent hook dependency issues)
  const courtOptions: CourtOption[] = useMemo(() => slot.courtOptions || [], [slot.courtOptions]);

  // Check if payments are enabled
  const paymentsEnabled = facility.paymentsEnabled ?? false;

  // Helper to get court option by court ID
  const getCourtOption = useCallback(
    (courtId: string): CourtOption | undefined => {
      return courtOptions.find(opt => opt.courtId === courtId);
    },
    [courtOptions]
  );

  // Filter courts to only show those available for this specific time slot
  // When payments aren't enabled, only show courts that are free
  const availableCourts = useMemo(() => {
    // If no court options, we can't determine which courts are available
    if (!courtOptions.length) {
      // If payments are enabled, show all courts
      // If not, we have no price info so show nothing
      return paymentsEnabled ? courts : [];
    }

    // Build a map of courtId -> price for quick lookup
    const courtIdToPriceMap = new Map<string, number>();
    for (const opt of courtOptions) {
      if (opt.courtId) {
        courtIdToPriceMap.set(opt.courtId, opt.price ?? 0);
      }
    }

    // Filter courts that have a court option
    let filtered = courts.filter(court => courtIdToPriceMap.has(court.id));

    // If payments aren't enabled, only show FREE courts (price === 0)
    if (!paymentsEnabled) {
      filtered = filtered.filter(court => {
        const price = courtIdToPriceMap.get(court.id);
        return price === 0;
      });
    }

    return filtered;
  }, [courts, courtOptions, paymentsEnabled]);

  // Get count of unavailable courts (paid courts when payments not enabled)
  const unavailablePaidCourtCount = useMemo(() => {
    if (paymentsEnabled || !courtOptions.length) return 0;

    // Count court options with courtId that have a non-zero price
    let paidCount = 0;
    for (const opt of courtOptions) {
      if (opt.courtId && (opt.price ?? 0) > 0) {
        paidCount++;
      }
    }
    return paidCount;
  }, [courtOptions, paymentsEnabled]);

  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null);

  // Set initial selected court when available courts change (sheet opened or payload updated)
  useEffect(() => {
    if (availableCourts.length === 0) {
      setSelectedCourt(null);
    } else if (availableCourts.length === 1) {
      setSelectedCourt(availableCourts[0]);
    } else {
      setSelectedCourt(prev => (prev && availableCourts.some(c => c.id === prev.id) ? prev : null));
    }
  }, [availableCourts]);

  // Handle court selection
  const handleSelectCourt = useCallback((court: Court) => {
    lightHaptic();
    setSelectedCourt(court);
  }, []);

  // Price to display - defined before handleBook since it uses it
  const displayPrice = useMemo(() => {
    // Find matching court option for price
    const courtOption = courtOptions.find(opt => opt.courtId === selectedCourt?.id);
    // If we have a court option, use its price
    // Otherwise, if no court is selected yet, fall back to slot.price
    // If a court is selected but no option found, show 0 (shouldn't happen after filtering)
    if (courtOption) {
      return courtOption.price ?? 0;
    }
    if (!selectedCourt) {
      // No court selected - show lowest available price when payments not enabled
      if (!paymentsEnabled && courtOptions.length > 0) {
        const freeCourts = courtOptions.filter(opt => (opt.price ?? 0) === 0);
        if (freeCourts.length > 0) {
          return 0; // Show free since there are free courts
        }
      }
      return slot.price;
    }
    // Court selected but no option found - shouldn't happen, show 0
    return 0;
  }, [courtOptions, selectedCourt, slot.price, paymentsEnabled]);

  // Handle booking
  const handleBook = useCallback(async () => {
    if (!selectedCourt) return;

    // Validate that payments are enabled if this is a paid slot
    const slotPrice = displayPrice ?? 0;
    if (!facility.paymentsEnabled && slotPrice > 0) {
      toast.error(t('facilityDetail.paymentsNotAvailable'));
      return;
    }

    mediumHaptic();
    setIsLoading(true);

    try {
      // Use local calendar date so evening slots (e.g. 8pm–11pm) don't send tomorrow's UTC date
      const y = slot.datetime.getFullYear();
      const m = String(slot.datetime.getMonth() + 1).padStart(2, '0');
      const d = String(slot.datetime.getDate()).padStart(2, '0');
      const bookingDate = `${y}-${m}-${d}`;
      // Convert 12-hour display times to 24-hour format (HH:MM:SS)
      const startTime = convertTo24Hour(slot.time);
      const endTime = convertTo24Hour(slot.endTime);

      Logger.info('Starting mobile booking', {
        courtId: selectedCourt.id,
        bookingDate,
        startTime,
        endTime,
      });

      // Create booking via Edge Function (useCreateBooking handles cache invalidation)
      const result = await createBookingAsync({
        courtId: selectedCourt.id,
        bookingDate,
        startTime,
        endTime,
      });

      // If payment is required, show Stripe PaymentSheet
      if (result.clientSecret) {
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: result.clientSecret,
          merchantDisplayName: 'Rallia',
        });

        if (initError) {
          throw new Error(initError.message);
        }

        const { error: paymentError } = await presentPaymentSheet();

        if (paymentError) {
          if (paymentError.code === 'Canceled') {
            // User cancelled - don't show error
            setIsLoading(false);
            return;
          }
          throw new Error(paymentError.message);
        }
      }

      // Success! Show success step (onSuccess called when user taps "Create game")
      setLastBookingResult({
        facilityId: facility.id,
        courtId: selectedCourt.id,
        courtNumber: selectedCourt.court_number ?? null,
      });
      setBookingSuccess(true);
      toast.success(t('booking.success.title'));

      // Invalidate the specific facility availability
      queryClient.invalidateQueries({ queryKey: courtAvailabilityKeys.facility(facility.id) });
    } catch (error) {
      Logger.error('Mobile booking failed', error as Error);
      const errorMessage = (error as Error).message || t('booking.error.generic');
      // Close the sheet first so the toast is visible (ActionSheet modal covers toasts)
      SheetManager.hide('court-booking');
      // Small delay to ensure the sheet is dismissed before showing the toast
      setTimeout(() => {
        toast.error(errorMessage);
      }, 300);
    } finally {
      setIsLoading(false);
    }
  }, [
    selectedCourt,
    slot,
    displayPrice,
    facility.id,
    facility.paymentsEnabled,
    createBookingAsync,
    initPaymentSheet,
    presentPaymentSheet,
    onSuccess,
    queryClient,
    t,
    toast,
  ]);

  // Format the date for display
  const formattedDate = useMemo(() => {
    return slot.datetime.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }, [slot.datetime]);

  // Check if price is free
  const isFree = displayPrice === 0 || displayPrice === undefined;

  if (!facility || !slot) return null;

  // Success step (matches MatchCreationWizard success step layout and styles)
  if (bookingSuccess) {
    return (
      <ActionSheet
        gestureEnabled
        containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
        indicatorStyle={[styles.handleIndicator, { backgroundColor: themeColors.border }]}
      >
        <View style={styles.modalContent}>
          <Animated.View style={[styles.successContainer, successAnimatedStyle]}>
            <TouchableOpacity
              onPress={handleDone}
              style={[
                styles.successCloseButton,
                { backgroundColor: isDark ? neutral[800] : neutral[100] },
              ]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-outline" size={20} color={themeColors.textMuted} />
            </TouchableOpacity>
            <View style={[styles.successIcon, { backgroundColor: themeColors.primary }]}>
              <Ionicons name="checkmark-circle" size={48} color="#ffffff" />
            </View>
            <Text size="xl" weight="bold" color={themeColors.text} style={styles.successTitle}>
              {t('booking.success.stepTitle')}
            </Text>
            <Text size="base" color={themeColors.textMuted} style={styles.successDescription}>
              {t('booking.success.createGamePrompt')}
            </Text>
            <View style={styles.successButtons}>
              <TouchableOpacity
                style={[styles.successButton, { backgroundColor: themeColors.primary }]}
                onPress={handleCreateGame}
              >
                <Text size="base" weight="semibold" color="#ffffff">
                  {t('booking.success.createGame')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.successButton,
                  { backgroundColor: isDark ? neutral[800] : neutral[200] },
                ]}
                onPress={handleDone}
              >
                <Text size="base" weight="semibold" color={themeColors.text}>
                  {t('booking.success.done')}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </ActionSheet>
    );
  }

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: themeColors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header - centered title, close button absolute right (matches UserProfile sheets) */}
        <View style={[styles.header, { borderBottomColor: themeColors.border }]}>
          <View style={styles.headerCenter}>
            <Text weight="semibold" size="lg" style={{ color: themeColors.text }}>
              {t('booking.confirmBooking')}
            </Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={themeColors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Booking Details Section */}
          <View style={[styles.section, { borderBottomColor: themeColors.border }]}>
            {/* Facility name */}
            <View style={styles.infoRow}>
              <View style={styles.infoIconContainer}>
                <Ionicons name="location" size={18} color={themeColors.primary} />
              </View>
              <View style={styles.infoContent}>
                <Text size="base" weight="semibold" color={themeColors.text}>
                  {facility.name}
                </Text>
              </View>
            </View>

            {/* Date */}
            <View style={[styles.infoRow, styles.infoRowSpacing]}>
              <View style={styles.infoIconContainer}>
                <Ionicons name="calendar" size={18} color={themeColors.iconMuted} />
              </View>
              <View style={styles.infoContent}>
                <Text size="sm" color={themeColors.text}>
                  {formattedDate}
                </Text>
              </View>
            </View>

            {/* Time with duration badge */}
            <View style={[styles.infoRow, styles.infoRowSpacing]}>
              <View style={styles.infoIconContainer}>
                <Ionicons name="time-outline" size={18} color={themeColors.iconMuted} />
              </View>
              <View style={styles.infoContent}>
                <View style={styles.timeRow}>
                  <Text size="sm" color={themeColors.text}>
                    {slot.time} - {slot.endTime}
                  </Text>
                  <View
                    style={[styles.durationBadge, { backgroundColor: themeColors.primaryLight }]}
                  >
                    <Text size="xs" weight="medium" color={themeColors.primary}>
                      1h
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Price */}
            <View style={[styles.infoRow, styles.infoRowSpacing]}>
              <View style={styles.infoIconContainer}>
                <Ionicons name="wallet" size={18} color={themeColors.iconMuted} />
              </View>
              <View style={styles.infoContent}>
                <Text size="sm" weight="semibold" color={isFree ? '#10b981' : themeColors.text}>
                  {formatPrice(displayPrice)}
                </Text>
              </View>
            </View>
          </View>

          {/* Court Selection Section */}
          {availableCourts.length > 1 && (
            <View style={[styles.section, { borderBottomColor: themeColors.border }]}>
              <View style={styles.sectionHeader}>
                <SportIcon
                  sportName={selectedSport?.name ?? 'tennis'}
                  size={18}
                  color={themeColors.primary}
                />
                <Text
                  size="base"
                  weight="semibold"
                  color={themeColors.text}
                  style={styles.sectionTitle}
                >
                  {t('booking.selectCourt')}
                </Text>
              </View>

              <View style={styles.courtList}>
                {availableCourts.map(court => {
                  const isSelected = selectedCourt?.id === court.id;
                  const courtOption = getCourtOption(court.id);
                  const courtPrice = courtOption?.price ?? slot.price ?? 0;
                  const isCourtFree = courtPrice === 0;

                  return (
                    <TouchableOpacity
                      key={court.id}
                      style={[
                        styles.courtCard,
                        {
                          backgroundColor: isSelected ? themeColors.primaryLight : themeColors.card,
                          borderColor: isSelected ? themeColors.primary : themeColors.border,
                        },
                      ]}
                      onPress={() => handleSelectCourt(court)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.courtInfo}>
                        <Text
                          size="sm"
                          weight={isSelected ? 'semibold' : 'regular'}
                          color={themeColors.text}
                        >
                          {court.name || `Court ${court.court_number}`}
                        </Text>
                        <Text size="xs" color={themeColors.textMuted}>
                          {t('booking.available')}
                        </Text>
                      </View>
                      <View style={styles.courtPriceContainer}>
                        <Text
                          size="sm"
                          weight="bold"
                          color={isCourtFree ? '#10b981' : themeColors.text}
                        >
                          {isCourtFree ? t('facilityDetail.free') : `$${courtPrice.toFixed(0)}`}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={22} color={themeColors.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Notice about unavailable paid courts */}
              {unavailablePaidCourtCount > 0 && (
                <View style={styles.unavailableNotice}>
                  <Ionicons
                    name="information-circle-outline"
                    size={14}
                    color={themeColors.textMuted}
                  />
                  <Text size="xs" color={themeColors.textMuted}>
                    {t('booking.paidCourtsUnavailable', { count: unavailablePaidCourtCount })}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Single court info when only one available */}
          {availableCourts.length === 1 && selectedCourt && (
            <View style={[styles.section, { borderBottomColor: themeColors.border }]}>
              <View style={styles.infoRow}>
                <View style={styles.infoIconContainer}>
                  <SportIcon
                    sportName={selectedSport?.name ?? 'tennis'}
                    size={18}
                    color={themeColors.primary}
                  />
                </View>
                <View style={styles.infoContent}>
                  <Text size="sm" weight="medium" color={themeColors.text}>
                    {selectedCourt.name || `Court ${selectedCourt.court_number}`}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Sticky Footer - outside ScrollView (matches UserProfile sheets) */}
        <View style={[styles.footer, { borderTopColor: themeColors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor: selectedCourt ? themeColors.primary : themeColors.textMuted,
                opacity: isLoading || isCreating || bookingSuccess ? 0.7 : 1,
              },
            ]}
            onPress={handleBook}
            disabled={!selectedCourt || isLoading || isCreating || bookingSuccess}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : bookingSuccess ? (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text size="lg" weight="semibold" color="#fff">
                  {t('booking.success.title')}
                </Text>
              </>
            ) : (
              <>
                <Text size="lg" weight="semibold" color="#fff">
                  {t('booking.bookNow')}
                </Text>
                {displayPrice !== undefined && displayPrice > 0 && (
                  <Text size="base" weight="bold" color="#fff">
                    {' '}
                    • {formatPrice(displayPrice)}
                  </Text>
                )}
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export default CourtBookingActionSheet;

const styles = StyleSheet.create({
  // Sheet base styles
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  modalContent: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },

  // Header - centered title, close absolute right (matches UserProfile sheets)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
  },

  // Sections - matches MatchDetailSheet
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

  // Info rows - matches MatchDetailSheet
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoRowSpacing: {
    marginTop: spacingPixels[3],
  },
  infoIconContainer: {
    width: spacingPixels[8],
    alignItems: 'center',
    paddingTop: spacingPixels[0.5],
  },
  infoContent: {
    flex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  durationBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },

  // Court selection
  courtList: {
    gap: spacingPixels[2],
  },
  courtCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1.5,
  },
  courtInfo: {
    flex: 1,
    gap: 2,
  },
  courtPriceContainer: {
    marginRight: spacingPixels[3],
  },
  unavailableNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginTop: spacingPixels[3],
  },

  // Footer - sticky at bottom (matches MatchCreationWizard)
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },

  // Success step (match MatchCreationWizard success step)
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
    paddingBottom: spacingPixels[4],
    position: 'relative',
  },
  successCloseButton: {
    position: 'absolute',
    top: spacingPixels[4],
    right: spacingPixels[4],
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  successTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  successDescription: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  successButtons: {
    gap: spacingPixels[3],
    width: '100%',
  },
  successButton: {
    flexDirection: 'row',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
