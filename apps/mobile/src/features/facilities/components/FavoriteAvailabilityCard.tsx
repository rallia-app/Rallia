/**
 * FavoriteAvailabilityCard
 * Compact carousel card for the Home "Open at your favorites" section. Shows a
 * provider-enabled favorite facility with its next bookable slots inlined from
 * search_facilities_nearby. Tapping a slot opens the provider booking flow;
 * tapping the card opens the facility detail screen.
 *
 * Visuals mirror FacilityCard (same surface + slot-chip treatment) but sized
 * for a horizontal carousel: fixed width, with the slot strip in a nested RNGH
 * ScrollView so it scrolls independently of the outer carousel.
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated } from 'react-native';
// RNGH ScrollView so the inner slot strip reliably claims horizontal drags that
// start on it (including on Android), while drags elsewhere on the card fall
// through to the outer carousel. Plain RN nested same-axis scroll is iOS-only
// reliable; RNGH coordinates the gesture on both platforms.
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { SheetManager } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, lightTheme, darkTheme } from '@rallia/design-system';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { lightHaptic } from '@rallia/shared-utils';
import { formatInlineSnapshotSlots, type FormattedSlot } from '@rallia/shared-hooks';

import { useRequireOnboarding, useThemeStyles } from '#/hooks';
import type { TranslationKey, TranslationOptions } from '#/hooks';

/** Fixed carousel slot width — leaves a peek of the next card. */
export const FAVORITE_AVAILABILITY_CARD_WIDTH = 280;

interface FavoriteAvailabilityCardProps {
  facility: FacilitySearchResult;
  onPress: (facility: FacilitySearchResult) => void;
  /** Optional override; defaults to opening the shared external-booking sheet. */
  onSlotPress?: (facility: FacilitySearchResult, slot: FormattedSlot) => void;
  /** Stretch to fill the container instead of the fixed carousel width.
   *  Used when it's the only card so it reads as a full section, not a peek. */
  fullWidth?: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

function formatDistance(meters: number | null): string {
  if (meters === null || meters === undefined) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function FavoriteAvailabilityCard({
  facility,
  onPress,
  onSlotPress,
  fullWidth = false,
  t,
}: FavoriteAvailabilityCardProps) {
  const { guardAction } = useRequireOnboarding();
  const { isDark } = useThemeStyles();

  const themeColors = isDark ? darkTheme : lightTheme;
  const cardBackground = isDark ? primary[950] : primary[50];
  const dynamicBorderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const textColor = themeColors.foreground;
  const mutedColor = themeColors.mutedForeground;
  const tierAccent = isDark ? primary[400] : primary[500];

  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.975,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => onPress(facility), [onPress, facility]);

  const { slotsByDate } = useMemo(
    () => formatInlineSnapshotSlots(facility.availability_slots, facility.timezone),
    [facility.availability_slots, facility.timezone]
  );

  const handleSlotPress = useCallback(
    (slot: FormattedSlot) => {
      if (!slot.bookingUrl) return;
      lightHaptic();
      if (!guardAction()) return;
      if (onSlotPress) {
        onSlotPress(facility, slot);
        return;
      }
      // Court selection + redirect runs through the shared external-booking
      // sheet (same as the facility detail availability tab).
      SheetManager.show('external-booking', {
        payload: { facility, slot, source: 'home_favorite_availability' },
      });
    },
    [facility, onSlotPress, guardAction]
  );

  const distanceText = formatDistance(facility.distance_meters);

  return (
    <Animated.View
      style={[
        fullWidth ? styles.wrapperFull : styles.wrapper,
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      <TouchableOpacity
        style={[styles.card, { backgroundColor: cardBackground, borderColor: dynamicBorderColor }]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={facility.name}
      >
        <View style={styles.content}>
          {/* Row 1: name + tap-through chevron */}
          <View style={styles.headerRow}>
            <Text
              size="base"
              weight="bold"
              color={textColor}
              numberOfLines={1}
              style={styles.nameText}
            >
              {facility.name}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={mutedColor} />
          </View>

          {/* Row 2: distance · court count */}
          {(distanceText || !!facility.court_count) && (
            <View style={styles.metaRow}>
              {distanceText && (
                <>
                  <Ionicons name="navigate-outline" size={13} color={tierAccent} />
                  <Text size="sm" color={tierAccent} weight="medium">
                    {distanceText}
                  </Text>
                </>
              )}
              {!!facility.court_count && (
                <>
                  {distanceText && (
                    <Text size="sm" color={mutedColor} style={styles.dotSeparator}>
                      ·
                    </Text>
                  )}
                  <Ionicons name="grid-outline" size={12} color={mutedColor} />
                  <Text size="sm" color={mutedColor}>
                    {facility.court_count === 1
                      ? t('facilitiesTab.badges.courtCountSingular')
                      : t('facilitiesTab.badges.courtCount').replace(
                          '{count}',
                          String(facility.court_count)
                        )}
                  </Text>
                </>
              )}
            </View>
          )}

          {/* Slots — full horizontal strip. The RNGH ScrollView claims drags
              that start on the slots; drags elsewhere scroll the outer carousel. */}
          {slotsByDate.length > 0 ? (
            <GestureScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.slotsScrollContent}
              style={styles.slotsScrollView}
            >
              {slotsByDate.map(dateGroup => (
                <View key={dateGroup.dateKey} style={styles.dateGroup}>
                  <Text
                    size="xs"
                    weight="semibold"
                    color={dateGroup.isToday ? tierAccent : mutedColor}
                    style={styles.dateLabel}
                  >
                    {dateGroup.dateLabel}
                  </Text>
                  <View style={styles.dateSlotsRow}>
                    {dateGroup.slots.map((slot, index) => {
                      const isTappable = !!slot.bookingUrl;
                      return (
                        <TouchableOpacity
                          key={`${slot.facilityScheduleId}-${index}`}
                          style={[
                            styles.slotChip,
                            {
                              backgroundColor: isTappable
                                ? `${tierAccent}15`
                                : isDark
                                  ? `${primary[400]}10`
                                  : `${primary[500]}08`,
                              borderColor: isTappable ? tierAccent : dynamicBorderColor,
                            },
                          ]}
                          onPress={() => isTappable && handleSlotPress(slot)}
                          disabled={!isTappable}
                          activeOpacity={0.7}
                        >
                          <Text
                            size="xs"
                            weight="medium"
                            color={isTappable ? tierAccent : mutedColor}
                          >
                            {slot.time}
                          </Text>
                          {slot.courtCount > 0 && (
                            <View
                              style={[
                                styles.courtCountBadge,
                                { backgroundColor: isTappable ? tierAccent : mutedColor },
                              ]}
                            >
                              <Text
                                size="xs"
                                weight="bold"
                                color={isTappable ? '#fff' : cardBackground}
                                style={styles.courtCountText}
                              >
                                {slot.courtCount}
                              </Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </GestureScrollView>
          ) : (
            <View style={styles.emptySlots}>
              <Ionicons name="calendar-clear-outline" size={14} color={mutedColor} />
              <Text size="xs" color={mutedColor}>
                {t('matchCreation.booking.noSlotsAvailable')}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default React.memo(FavoriteAvailabilityCard);

/** Compact loading placeholder matching the card's footprint. */
export const FavoriteAvailabilityCardSkeleton: React.FC = () => {
  const { isDark } = useThemeStyles();
  const cardBackground = isDark ? primary[950] : primary[50];
  const borderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const chipFill = isDark ? `${primary[400]}10` : `${primary[500]}08`;
  const skeletonBg = isDark ? primary[900] : primary[100];
  const skeletonHighlight = isDark ? primary[800] : primary[50];

  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, { backgroundColor: cardBackground, borderColor }]}>
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Skeleton
              width="60%"
              height={20}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>
          <View style={styles.metaRow}>
            <Skeleton
              width={48}
              height={14}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <Skeleton
              width={56}
              height={14}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>
          <View style={styles.skeletonSlots}>
            <Skeleton
              width={34}
              height={12}
              borderRadius={3}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <View style={styles.dateSlotsRow}>
              {[44, 44, 44].map((w, i) => (
                <View key={i} style={[styles.slotChip, { borderColor, backgroundColor: chipFill }]}>
                  <Skeleton
                    width={w - 16}
                    height={12}
                    borderRadius={3}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: FAVORITE_AVAILABILITY_CARD_WIDTH,
  },
  // Fills the (padded) container — used when it's the only card.
  wrapperFull: {
    width: '100%',
  },
  card: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 5,
  },
  content: {
    padding: spacingPixels[4],
    gap: spacingPixels[1.5],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  nameText: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  dotSeparator: {
    marginHorizontal: 2,
  },
  slotsScrollView: {
    marginTop: spacingPixels[2],
    marginHorizontal: -spacingPixels[4], // Extend to card edges
  },
  slotsScrollContent: {
    paddingLeft: spacingPixels[4],
    paddingRight: spacingPixels[2],
    gap: spacingPixels[4],
  },
  skeletonSlots: {
    gap: spacingPixels[1],
    marginTop: spacingPixels[2],
  },
  dateGroup: {
    gap: spacingPixels[1],
  },
  dateLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 10,
  },
  dateSlotsRow: {
    flexDirection: 'row',
    gap: spacingPixels[1.5],
  },
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  courtCountBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[0.5],
  },
  courtCountText: {
    fontSize: 10,
    lineHeight: 12,
    includeFontPadding: false,
  },
  emptySlots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[1],
    paddingVertical: spacingPixels[1],
  },
});
