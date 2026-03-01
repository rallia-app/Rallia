/**
 * ExternalBookingSheet Component
 * Bottom sheet for redirecting to external booking providers.
 * When multiple courts are available, lets the user pick which court
 * before redirecting to the provider's booking page.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import type { FormattedSlot, CourtOption } from '@rallia/shared-hooks';
import type { FacilityWithDetails } from '@rallia/shared-services';
import { Logger } from '@rallia/shared-services';
import { lightHaptic, mediumHaptic, selectionHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';

export function ExternalBookingActionSheet({ payload }: SheetProps<'external-booking'>) {
  const facility = payload?.facility as FacilityWithDetails;
  const slot = payload?.slot as FormattedSlot;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { selectedSport } = useSport();

  // Court selection state
  const courtOptions = useMemo(() => slot?.courtOptions ?? [], [slot?.courtOptions]);
  const hasMultipleCourts = courtOptions.length > 1;
  const [selectedCourt, setSelectedCourt] = useState<CourtOption | null>(
    // Auto-select if only one court option
    courtOptions.length === 1 ? courtOptions[0] : null
  );

  // Resolve the booking URL: selected court's URL > slot's default URL
  const bookingUrl = useMemo(() => {
    if (selectedCourt?.bookingUrl) return selectedCourt.bookingUrl;
    if (courtOptions.length === 1 && courtOptions[0]?.bookingUrl) return courtOptions[0].bookingUrl;
    return slot?.bookingUrl ?? null;
  }, [selectedCourt, courtOptions, slot?.bookingUrl]);

  const handleClose = useCallback(() => {
    selectionHaptic();
    SheetManager.hide('external-booking');
  }, []);

  const handleSelectCourt = useCallback((court: CourtOption) => {
    lightHaptic();
    setSelectedCourt(court);
  }, []);

  // Handle opening external booking URL
  const handleOpenBookingSite = useCallback(async () => {
    if (hasMultipleCourts && !selectedCourt) {
      toast.error(t('booking.selectCourtFirst'));
      return;
    }

    if (!bookingUrl) {
      toast.error('Booking URL not available');
      return;
    }

    mediumHaptic();

    Logger.logUserAction('external_booking_opened', {
      facilityId: facility.id,
      facilityName: facility.name,
      slotTime: slot.time,
      bookingUrl,
      courtName: selectedCourt?.courtName,
    });

    try {
      const canOpen = await Linking.canOpenURL(bookingUrl);
      if (canOpen) {
        await Linking.openURL(bookingUrl);
        handleClose();
      } else {
        toast.error('Unable to open booking site');
      }
    } catch (error) {
      Logger.error('Failed to open external booking URL', error as Error);
      toast.error('Failed to open booking site');
    }
  }, [slot, facility, bookingUrl, selectedCourt, hasMultipleCourts, handleClose, toast, t]);

  // Format date for display
  const formattedDate = useMemo(() => {
    return slot?.datetime.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }, [slot?.datetime]);

  // Get court display name
  const getCourtDisplayName = useCallback(
    (court: CourtOption) => {
      if (court.courtNumber !== undefined) {
        return t('matchCreation.booking.courtNumber').replace(
          '{number}',
          String(court.courtNumber)
        );
      }
      return court.courtName;
    },
    [t]
  );

  const primaryLight = isDark ? primary[900] : primary[50];
  const canSubmit = !hasMultipleCourts || selectedCourt !== null;

  if (!facility || !slot) return null;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetContainer, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('booking.external.title')}
          </Text>
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Scrollable Content */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Booking details section */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          {/* Facility */}
          <View style={styles.infoRow}>
            <View style={styles.infoIconContainer}>
              <Ionicons name="location" size={18} color={colors.primary} />
            </View>
            <View style={styles.infoContent}>
              <Text size="base" weight="semibold" color={colors.text}>
                {facility.name}
              </Text>
            </View>
          </View>

          {/* Date */}
          <View style={[styles.infoRow, styles.infoRowSpacing]}>
            <View style={styles.infoIconContainer}>
              <Ionicons name="calendar" size={18} color={colors.textMuted} />
            </View>
            <View style={styles.infoContent}>
              <Text size="sm" color={colors.text}>
                {formattedDate}
              </Text>
            </View>
          </View>

          {/* Time with duration badge */}
          <View style={[styles.infoRow, styles.infoRowSpacing]}>
            <View style={styles.infoIconContainer}>
              <Ionicons name="time-outline" size={18} color={colors.textMuted} />
            </View>
            <View style={styles.infoContent}>
              <View style={styles.timeRow}>
                <Text size="sm" color={colors.text}>
                  {slot.time} - {slot.endTime}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Court selection section (when multiple courts) */}
        {hasMultipleCourts && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <SportIcon
                sportName={selectedSport?.name ?? 'tennis'}
                size={18}
                color={colors.primary}
              />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('booking.selectCourt')}
              </Text>
              <View style={styles.sectionBadge}>
                <Text size="xs" color={colors.textMuted}>
                  {courtOptions.length}{' '}
                  {courtOptions.length === 1
                    ? t('matchCreation.booking.courtAvailable')
                    : t('matchCreation.booking.courtsAvailable')}
                </Text>
              </View>
            </View>

            <View style={styles.courtList}>
              {courtOptions.map((court, index) => {
                const isSelected = selectedCourt?.externalCourtId === court.externalCourtId;
                return (
                  <TouchableOpacity
                    key={`${court.facilityScheduleId}-${index}`}
                    style={[
                      styles.courtCard,
                      {
                        backgroundColor: isSelected ? primaryLight : colors.card,
                        borderColor: isSelected ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => handleSelectCourt(court)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.courtIconContainer,
                        { backgroundColor: isSelected ? `${colors.primary}20` : primaryLight },
                      ]}
                    >
                      <SportIcon
                        sportName={selectedSport?.name ?? 'tennis'}
                        size={18}
                        color={colors.primary}
                      />
                    </View>
                    <View style={styles.courtInfo}>
                      <Text
                        size="sm"
                        weight={isSelected ? 'semibold' : 'regular'}
                        color={colors.text}
                      >
                        {getCourtDisplayName(court)}
                      </Text>
                      {court.price !== undefined && court.price > 0 && (
                        <Text size="xs" color={colors.textMuted}>
                          ${court.price.toFixed(2)}
                        </Text>
                      )}
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Single court display */}
        {courtOptions.length === 1 && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <View style={styles.infoRow}>
              <View style={styles.infoIconContainer}>
                <SportIcon
                  sportName={selectedSport?.name ?? 'tennis'}
                  size={18}
                  color={colors.primary}
                />
              </View>
              <View style={styles.infoContent}>
                <Text size="sm" weight="medium" color={colors.text}>
                  {getCourtDisplayName(courtOptions[0])}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Instructions */}
        <View style={styles.instructionsContainer}>
          <Text size="sm" color={colors.textMuted} style={styles.instructions}>
            {t('booking.external.instructions')}
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            {
              backgroundColor: canSubmit ? colors.primary : colors.textMuted,
            },
          ]}
          onPress={handleOpenBookingSite}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          <Ionicons name="open-outline" size={20} color="#fff" />
          <Text size="lg" weight="semibold" color="#fff">
            {t('booking.external.openSite')}
          </Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export default ExternalBookingActionSheet;

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
  scrollContent: {
    paddingBottom: spacingPixels[4],
  },

  // Sections (matches CourtBookingSheet)
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
    flex: 1,
  },
  sectionBadge: {
    marginLeft: spacingPixels[2],
  },

  // Info rows (matches CourtBookingSheet)
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

  // Court selection (matches CourtBookingSheet)
  courtList: {
    gap: spacingPixels[2],
  },
  courtCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1.5,
    gap: spacingPixels[3],
  },
  courtIconContainer: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courtInfo: {
    flex: 1,
    gap: 2,
  },

  // Instructions
  instructionsContainer: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
  },
  instructions: {
    textAlign: 'center',
    fontStyle: 'italic',
  },

  // Footer
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});
