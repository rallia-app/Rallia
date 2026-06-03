/**
 * MatchAvailableCourtsSection
 *
 * Shown inside MatchDetailSheet to the host of a match when:
 *  - the match is linked to a facility, AND
 *  - no court has been booked yet (court_status !== 'reserved'), AND
 *  - the facility has real-time snapshot availability at the match start time.
 *
 * Reads the availability rows inlined onto the match by the fetchers
 * (`match.available_courts_slots`, populated from `facility_availability_snapshot`
 * alongside the `available_courts` count) — no separate availability round trip.
 * Renders one tile per available court at the exact match start time. Tapping a
 * tile goes directly to that court's external booking URL; the pending booking
 * is tagged with matchId so the return flow (handled in
 * PendingExternalBookingContext) can link the booked court back to the match.
 */

import React, { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, neutral } from '@rallia/design-system';
import type { CourtOption, FormattedSlot } from '@rallia/shared-hooks';
import { formatInlineSnapshotSlots } from '@rallia/shared-hooks';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { useTranslation, useThemeStyles, useOpenExternalBooking } from '#/hooks';

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

  const matchTimezone: string = match.facility?.timezone ?? match.timezone;

  // Format the inlined snapshot rows into grouped slots. The rows are already
  // scoped (server-side) to the match's exact start time and sport, so this
  // yields a single slot whose courtOptions are the bookable courts. No fetch.
  const slots = useMemo(
    () => formatInlineSnapshotSlots(match.available_courts_slots, matchTimezone).slots,
    [match.available_courts_slots, matchTimezone]
  );

  const matchingSlot = useMemo(
    () =>
      slots.find(slot =>
        slotMatchesMatchStart(slot, match.match_date, match.start_time, matchTimezone)
      ) ?? null,
    [slots, match.match_date, match.start_time, matchTimezone]
  );

  const courtOptions = matchingSlot?.courtOptions ?? [];

  // openExternalBooking only needs these identity/display fields off the
  // facility relation — no full facility fetch required.
  const facilityForBooking = match.facility
    ? {
        id: match.facility.id,
        name: match.facility.name,
        address: match.facility.address,
        city: match.facility.city,
        timezone: match.facility.timezone ?? matchTimezone,
      }
    : null;

  const handleCourtPress = useCallback(
    async (court: CourtOption) => {
      if (!facilityForBooking || !matchingSlot) return;
      await openExternalBooking({
        facility: facilityForBooking,
        slot: matchingSlot,
        selectedCourt: court,
        matchId: match.id,
        source: 'match_courts',
        sportId: match.sport?.id,
        sportName: match.sport?.name,
      });
    },
    [
      facilityForBooking,
      matchingSlot,
      match.id,
      match.sport?.id,
      match.sport?.name,
      openExternalBooking,
    ]
  );

  // Host-only, unreserved matches with ≥1 bookable court at the start time.
  // Anything else (no slots inlined, court already booked, viewer not the
  // host) collapses the section away.
  if (!isCreator || match.court_status === 'reserved' || courtOptions.length === 0) {
    return null;
  }

  const formatCourtLabel = (court: CourtOption) => {
    if (court.courtNumber !== undefined && court.courtNumber !== null) {
      return t('matchCreation.booking.courtNumber').replace('{number}', String(court.courtNumber));
    }
    return court.courtName;
  };

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
        {courtOptions.map((court, index) => {
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
