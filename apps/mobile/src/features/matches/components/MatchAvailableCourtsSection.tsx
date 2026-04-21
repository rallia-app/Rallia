/**
 * MatchAvailableCourtsSection
 *
 * Shown inside MatchDetailSheet to the host of a match when:
 *  - the match is linked to a facility with real-time court availability, AND
 *  - no court has been booked yet (court_status !== 'reserved').
 *
 * Renders one tile per available court at the exact match start time. Tapping
 * a tile goes directly to that court's external booking URL; the pending
 * booking is tagged with matchId so the return flow (handled in
 * PendingExternalBookingContext) can link the booked court back to the match.
 */

import React, { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, neutral } from '@rallia/design-system';
import type { CourtOption, FormattedSlot } from '@rallia/shared-hooks';
import { useCourtAvailability, useFacilityDetail } from '@rallia/shared-hooks';
import { getTimeDifferenceFromNow } from '@rallia/shared-utils';

import type { MatchDetailData } from '../../../context/MatchDetailSheetContext';
import { useTranslation, useThemeStyles, useOpenExternalBooking } from '../../../hooks';

interface MatchAvailableCourtsSectionProps {
  match: MatchDetailData;
  isCreator: boolean;
  animationDelay?: number;
}

/**
 * Compare a slot's start datetime (a JS Date) to the match's wall-clock
 * start time in the facility timezone. Returns true if the slot starts at
 * the exact same date + HH:mm in that timezone.
 */
function slotMatchesMatchStart(
  slot: FormattedSlot,
  matchDate: string,
  matchStartTime: string,
  timezone: string | null | undefined
): boolean {
  if (!timezone) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(slot.datetime);

    const byType: Record<string, string> = {};
    for (const p of parts) byType[p.type] = p.value;
    const slotDate = `${byType.year}-${byType.month}-${byType.day}`;
    // `hour` may come back as "24" for midnight in some runtimes — normalize.
    const hour = byType.hour === '24' ? '00' : byType.hour;
    const slotTime = `${hour}:${byType.minute}`;
    return slotDate === matchDate && slotTime === matchStartTime.substring(0, 5);
  } catch {
    return false;
  }
}

export function MatchAvailableCourtsSection({
  match,
  isCreator,
  animationDelay = 275,
}: MatchAvailableCourtsSectionProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const { openExternalBooking } = useOpenExternalBooking();

  const facilityId = match.facility_id ?? null;
  const sportId = match.sport?.id ?? null;
  const matchTimezone: string = match.facility?.timezone ?? match.timezone;

  const isFutureMatch = useMemo(() => {
    try {
      return getTimeDifferenceFromNow(match.match_date, match.start_time, matchTimezone) > 0;
    } catch {
      return false;
    }
  }, [match.match_date, match.start_time, matchTimezone]);

  // Quick signal (from the raw match.facility relation) that this facility is likely
  // backed by a real-time availability provider. data_provider_id can live at the
  // organization level, but external_provider_id is always on the facility row when
  // the facility is mapped to an external booking system — so it's a reliable gate.
  const facilityLooksProviderBacked = !!match.facility?.external_provider_id;

  const gateBeforeFetch =
    isCreator &&
    !!facilityId &&
    !!sportId &&
    match.court_status !== 'reserved' &&
    isFutureMatch &&
    facilityLooksProviderBacked;

  const { facility, isLoading: isFacilityLoading } = useFacilityDetail({
    facilityId: facilityId ?? '',
    sportId: sportId ?? '',
    enabled: gateBeforeFetch,
  });

  const {
    slots,
    isLoading: isSlotsLoading,
    hasProvider,
  } = useCourtAvailability({
    facilityId: facilityId ?? '',
    dataProviderId: facility?.data_provider_id ?? null,
    dataProviderType: facility?.data_provider_type ?? null,
    externalProviderId: facility?.external_provider_id ?? null,
    bookingUrlTemplate: facility?.booking_url_template ?? null,
    facilityTimezone: facility?.timezone ?? matchTimezone,
    sportName: match.sport?.name,
    dates: [match.match_date],
    enabled: gateBeforeFetch && !!facility,
  });

  const matchingSlot = useMemo(() => {
    if (!gateBeforeFetch) return null;
    return (
      slots.find(slot =>
        slotMatchesMatchStart(slot, match.match_date, match.start_time, matchTimezone)
      ) ?? null
    );
  }, [gateBeforeFetch, slots, match.match_date, match.start_time, matchTimezone]);

  const courtOptions = matchingSlot?.courtOptions ?? [];

  const handleCourtPress = useCallback(
    async (court: CourtOption) => {
      if (!facility || !matchingSlot) return;
      await openExternalBooking({
        facility,
        slot: matchingSlot,
        selectedCourt: court,
        matchId: match.id,
      });
    },
    [facility, matchingSlot, match.id, openExternalBooking]
  );

  // We render the section shell as soon as the quick gate passes, even while the
  // provider/availability queries are still in flight — the tiles area shows a
  // skeleton state until slots resolve.
  if (!gateBeforeFetch) return null;

  const isResolving = isFacilityLoading || isSlotsLoading || (!facility && !hasProvider);
  const availabilityResolved = !!facility && !isSlotsLoading;

  // Once we've resolved availability, hide the section if the facility turns out
  // not to have a real-time provider, or there are no courts at the match start.
  if (availabilityResolved && (!hasProvider || courtOptions.length === 0)) return null;

  const formatCourtLabel = (court: CourtOption) => {
    if (court.courtNumber !== undefined && court.courtNumber !== null) {
      return t('matchCreation.booking.courtNumber').replace('{number}', String(court.courtNumber));
    }
    return court.courtName;
  };

  // Skeleton colors, mirroring the pattern in FacilitiesDirectory.tsx
  const skeletonBg = isDark ? '#262626' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#404040' : '#F2F8FC';

  return (
    <Animated.View
      entering={FadeInDown.delay(animationDelay).springify()}
      style={[styles.section, { borderBottomColor: colors.border }]}
    >
      <View style={styles.sectionHeader}>
        <Ionicons name="sparkles-outline" size={20} color={colors.iconMuted} />
        <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
          {t('matchDetail.availableCourtsHeader')}
        </Text>
      </View>

      <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
        {t('matchDetail.availableCourtsSubtitle')}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tilesRow}
      >
        {isResolving && courtOptions.length === 0
          ? [0, 1, 2, 3].map(i => (
              <View
                key={`skeleton-${i}`}
                style={[
                  styles.tile,
                  {
                    backgroundColor: isDark ? neutral[800] : neutral[50],
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.tileHeader}>
                  <Skeleton
                    width="70%"
                    height={14}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                  <Skeleton
                    width={14}
                    height={14}
                    borderRadius={7}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                </View>
                <View style={styles.tileFooter}>
                  <Skeleton
                    width={44}
                    height={18}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                </View>
              </View>
            ))
          : courtOptions.map((court, index) => {
              const price = court.price;
              const isFree = price === 0;
              const hasPrice = typeof price === 'number' && price > 0;
              return (
                <Pressable
                  key={`${court.facilityScheduleId}-${court.externalCourtId}-${index}`}
                  onPress={() => {
                    void handleCourtPress(court);
                  }}
                  style={({ pressed }) => [
                    styles.tile,
                    {
                      backgroundColor: isDark ? neutral[800] : neutral[50],
                      borderColor: colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={styles.tileHeader}>
                    <Text size="sm" weight="semibold" color={colors.text} style={styles.tileName}>
                      {formatCourtLabel(court)}
                    </Text>
                    <Ionicons name="open-outline" size={14} color={colors.iconMuted} />
                  </View>
                  <View style={styles.tileFooter}>
                    {hasPrice ? (
                      <Text size="sm" weight="semibold" color={colors.text}>
                        ${price.toFixed(0)}
                      </Text>
                    ) : isFree ? (
                      <Text size="sm" weight="semibold" color={colors.textMuted}>
                        {t('facilityDetail.free')}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
      </ScrollView>
    </Animated.View>
  );
}

export default MatchAvailableCourtsSection;

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  sectionTitle: {
    marginLeft: spacingPixels[2],
  },
  subtitle: {
    marginBottom: spacingPixels[3],
  },
  tilesRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacingPixels[2],
    paddingRight: spacingPixels[5],
  },
  tile: {
    width: 120,
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    padding: spacingPixels[3],
    gap: spacingPixels[2],
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileName: {
    flex: 1,
    marginRight: spacingPixels[1],
  },
  tileFooter: {},
});
