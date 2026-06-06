/**
 * MatchAvailableCourtsSection
 *
 * Shown inside MatchDetailSheet to any viewer of a match when:
 *  - the match is linked to a facility, AND
 *  - no court has been booked yet (court_status !== 'reserved'), AND
 *  - the facility has real-time snapshot availability at the match start time.
 *
 * Reads the availability rows inlined onto the match by the fetchers
 * (`match.available_courts_slots`, populated from `facility_availability_snapshot`
 * alongside the `available_courts` count) — no separate availability round trip.
 * Renders one tile per available court at the exact match start time. Tapping a
 * tile goes directly to that court's external booking URL. For the host, the
 * pending booking is tagged with matchId so the return flow (handled in
 * PendingExternalBookingContext) links the booked court back to the match.
 * Non-hosts can only update their own matches (RLS), so their tap is a plain
 * external booking with no match link.
 */

import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, neutral, status, base } from '@rallia/design-system';
import type { CourtOption, FormattedSlot } from '@rallia/shared-hooks';
import { formatInlineSnapshotSlots } from '@rallia/shared-hooks';
import { searchFacilitiesNearby } from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { useTranslation, useThemeStyles, useOpenExternalBooking } from '#/hooks';

/** Nearby-facility fallback radius + count when the match facility has no courts left at game time. */
const NEARBY_RADIUS_KM = 25;
const NEARBY_MAX_FACILITIES = 3;

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

type ThemeStyleColors = ReturnType<typeof useThemeStyles>['colors'];

interface CourtTileProps {
  court: CourtOption;
  label: string;
  freeLabel: string;
  colors: ThemeStyleColors;
  isDark: boolean;
  onPress: (court: CourtOption) => void;
}

/**
 * Single bookable-court tile. Owns its own press-scale spring so the tactile
 * feedback matches MatchCard (RN Animated spring on pressIn/pressOut).
 */
function CourtTile({ court, label, freeLabel, colors, isDark, onPress }: CourtTileProps) {
  const scale = useMemo(() => new RNAnimated.Value(1), []);
  const price = court.price;
  const isFree = price === 0;
  const hasPrice = typeof price === 'number' && price > 0;

  const handlePressIn = () => {
    RNAnimated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    RNAnimated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  return (
    <RNAnimated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => onPress(court)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.tile,
          { backgroundColor: isDark ? neutral[800] : base.white, borderColor: colors.border },
        ]}
      >
        <View style={styles.tileTop}>
          <Text
            size="sm"
            weight="semibold"
            color={colors.text}
            numberOfLines={2}
            style={styles.tileName}
          >
            {label}
          </Text>
          <Ionicons name="open-outline" size={13} color={colors.iconMuted} />
        </View>

        {hasPrice ? (
          <View
            style={[styles.pricePill, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}
          >
            <Text size="xs" weight="bold" color={colors.text}>
              ${price.toFixed(0)}
            </Text>
          </View>
        ) : isFree ? (
          <View style={[styles.pricePill, { backgroundColor: status.success.DEFAULT + '1A' }]}>
            <Text size="xs" weight="bold" color={status.success.DEFAULT}>
              {freeLabel}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </RNAnimated.View>
  );
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
        // Only the host can attach the booked court to the match (RLS); for
        // everyone else this is a plain external booking with no match link.
        matchId: isCreator ? match.id : undefined,
        source: 'match_courts',
        sportId: match.sport?.id,
        sportName: match.sport?.name,
      });
    },
    [
      facilityForBooking,
      matchingSlot,
      isCreator,
      match.id,
      match.sport?.id,
      match.sport?.name,
      openExternalBooking,
    ]
  );

  // --- Nearby-facility fallback ---------------------------------------------
  // When the match facility has no bookable court at the game's start time, look
  // for courts at surrounding facilities (same sport, same slot). Only runs once
  // the facility itself has come up empty and the match isn't already reserved.
  const facilityLat = match.facility?.latitude;
  const facilityLng = match.facility?.longitude;
  const sportId = match.sport?.id;
  const needsNearby =
    match.court_status !== 'reserved' &&
    courtOptions.length === 0 &&
    facilityLat != null &&
    facilityLng != null &&
    !!sportId;

  const { data: nearbyPage, isLoading: nearbyLoading } = useQuery({
    queryKey: ['match-nearby-courts', match.id, sportId, match.match_date, match.start_time],
    queryFn: () =>
      searchFacilitiesNearby({
        sportIds: [sportId as string],
        latitude: Number(facilityLat),
        longitude: Number(facilityLng),
        maxDistanceKm: NEARBY_RADIUS_KM,
        hasOpenSlots: true,
        // +1 because the origin facility comes back in the results and we filter
        // it out below; request one extra so we can still show MAX nearby ones.
        limit: NEARBY_MAX_FACILITIES + 1,
      }),
    enabled: needsNearby,
    staleTime: 60_000,
  });

  // Per nearby facility, the single slot matching the match's start time.
  const nearbyOptions = useMemo(() => {
    const out: Array<{ facility: FacilitySearchResult; slot: FormattedSlot }> = [];
    if (!nearbyPage) return out;
    for (const facility of nearbyPage.facilities) {
      if (out.length >= NEARBY_MAX_FACILITIES) break;
      if (facility.id === match.facility_id) continue;
      const facilitySlots = formatInlineSnapshotSlots(
        facility.availability_slots,
        facility.timezone
      ).slots;
      const slot = facilitySlots.find(s =>
        slotMatchesMatchStart(s, match.match_date, match.start_time, facility.timezone)
      );
      if (slot && slot.courtOptions.length > 0) out.push({ facility, slot });
    }
    return out;
  }, [nearbyPage, match.facility_id, match.match_date, match.start_time]);

  const handleNearbyCourtPress = useCallback(
    async (facility: FacilitySearchResult, slot: FormattedSlot, court: CourtOption) => {
      await openExternalBooking({
        facility: {
          id: facility.id,
          name: facility.name,
          address: facility.address,
          city: facility.city,
          timezone: facility.timezone,
        },
        slot,
        selectedCourt: court,
        // Booking a nearby alternative relocates the host's match to that
        // facility on return (the confirm flow updates facility_id + court_id).
        // Host only — RLS restricts match updates to the creator.
        matchId: isCreator ? match.id : undefined,
        source: 'match_courts',
        sportId,
        sportName: match.sport?.name,
      });
    },
    [openExternalBooking, isCreator, match.id, sportId, match.sport?.name]
  );

  const formatCourtLabel = (court: CourtOption) => {
    if (court.courtNumber !== undefined && court.courtNumber !== null) {
      return t('matchCreation.booking.courtNumber').replace('{number}', String(court.courtNumber));
    }
    return court.courtName;
  };

  // Court already reserved → nothing to do.
  if (match.court_status === 'reserved') {
    return null;
  }

  // Facility has courts at game time → the primary booking section. The host
  // gets the match-linking booking flow; non-hosts get a plain external booking.
  if (courtOptions.length > 0) {
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
          {courtOptions.map((court, index) => (
            <CourtTile
              key={`${court.facilityScheduleId}-${court.externalCourtId}-${index}`}
              court={court}
              label={formatCourtLabel(court)}
              freeLabel={t('facilityDetail.free')}
              colors={colors}
              isDark={isDark}
              onPress={court => {
                void handleCourtPress(court);
              }}
            />
          ))}
        </ScrollView>
      </Animated.View>
    );
  }

  // Facility full at game time → surface nearby facilities (loading or results).
  if (needsNearby && (nearbyLoading || nearbyOptions.length > 0)) {
    return (
      <Animated.View
        entering={FadeInDown.delay(animationDelay).springify()}
        style={[styles.section, { borderBottomColor: colors.border }]}
      >
        <View style={styles.sectionHeader}>
          <Ionicons name="navigate-outline" size={20} color={colors.iconMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
            {t('matchDetail.nearbyCourtsHeader')}
          </Text>
        </View>

        <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
          {t('matchDetail.nearbyCourtsSubtitle')}
        </Text>

        {nearbyLoading && nearbyOptions.length === 0 ? (
          <View style={styles.nearbyLoading}>
            <ActivityIndicator color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted}>
              {t('matchDetail.availableCourtsLoading')}
            </Text>
          </View>
        ) : (
          nearbyOptions.map(({ facility, slot }) => (
            <View key={facility.id} style={styles.nearbyGroup}>
              <Text
                size="sm"
                weight="semibold"
                color={colors.text}
                style={styles.nearbyFacilityName}
              >
                {facility.name}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tilesRow}
              >
                {slot.courtOptions.map((court, index) => (
                  <CourtTile
                    key={`${facility.id}-${court.externalCourtId}-${index}`}
                    court={court}
                    label={formatCourtLabel(court)}
                    freeLabel={t('facilityDetail.free')}
                    colors={colors}
                    isDark={isDark}
                    onPress={court => {
                      void handleNearbyCourtPress(facility, slot, court);
                    }}
                  />
                ))}
              </ScrollView>
            </View>
          ))
        )}
      </Animated.View>
    );
  }

  return null;
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
  nearbyLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[2],
  },
  nearbyGroup: {
    marginBottom: spacingPixels[3],
  },
  nearbyFacilityName: {
    marginBottom: spacingPixels[2],
  },
  tilesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
    paddingRight: spacingPixels[5],
    paddingVertical: spacingPixels[1],
  },
  tile: {
    width: 136,
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    padding: spacingPixels[3],
    gap: spacingPixels[2],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacingPixels[1],
  },
  tileName: {
    flex: 1,
  },
  pricePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: 999,
  },
});
