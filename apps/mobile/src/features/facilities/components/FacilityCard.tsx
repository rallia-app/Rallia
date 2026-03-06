/**
 * FacilityCard Component
 * Displays a facility in a card format with name, address, distance,
 * availability preview, and favorite toggle.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Animated, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { lightHaptic } from '@rallia/shared-utils';
import { useCourtAvailability, type FormattedSlot } from '@rallia/shared-hooks';
import { useAuth } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';
import type { TranslationKey, TranslationOptions } from '../../../hooks';

interface FacilityCardProps {
  facility: FacilitySearchResult;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: (facility: FacilitySearchResult) => void;
  isMaxFavoritesReached: boolean;
  /** When false, the favorite heart is hidden (e.g. signed out or not onboarded). When undefined, falls back to isAuthenticated. */
  showFavoriteButton?: boolean;
  /** Sport name for filtering provider availability (e.g., "tennis") */
  sportName?: string;
  /** Whether dark mode is active */
  isDark: boolean;
  colors: {
    card: string;
    cardForeground: string;
    text: string;
    textMuted: string;
    primary: string;
    border: string;
    error: string;
  };
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

// =============================================================================
// SKELETON SLOT PLACEHOLDER
// =============================================================================

function SlotSkeleton({ color }: { color: string }) {
  const pulseAnim = useMemo(() => new Animated.Value(0.3), []);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.slotsSkeletonRow}>
      {[1, 2, 3].map(i => (
        <Animated.View
          key={i}
          style={{
            width: 56,
            height: 24,
            borderRadius: 12,
            backgroundColor: color,
            opacity: pulseAnim,
          }}
        />
      ))}
    </View>
  );
}

/**
 * Formats distance in meters to a human-readable string
 */
function formatDistance(meters: number | null): string {
  if (meters === null || meters === undefined) return '';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export default function FacilityCard({
  facility,
  isFavorite,
  onPress,
  onToggleFavorite,
  isMaxFavoritesReached,
  showFavoriteButton,
  sportName,
  isDark,
  colors,
  t,
}: FacilityCardProps) {
  const { isAuthenticated } = useAuth();
  const canShowFavorite = showFavoriteButton !== undefined ? showFavoriteButton : isAuthenticated;

  const handleFavoritePress = useCallback(() => {
    lightHaptic();
    onToggleFavorite(facility);
  }, [facility, onToggleFavorite]);

  const distanceText = formatDistance(facility.distance_meters);
  const addressText = facility.address || facility.city || '';

  // Court availability
  const { slotsByDate, isLoading: slotsLoading } = useCourtAvailability({
    facilityId: facility.id,
    dataProviderId: facility.data_provider_id,
    dataProviderType: facility.data_provider_type,
    externalProviderId: facility.external_provider_id,
    bookingUrlTemplate: facility.booking_url_template,
    facilityTimezone: facility.timezone,
    sportName,
  });

  const handleSlotPress = useCallback((slot: FormattedSlot) => {
    if (slot.bookingUrl) {
      lightHaptic();
      Linking.openURL(slot.bookingUrl);
    }
  }, []);

  // Determine if favorite toggle should be disabled
  const favoriteDisabled = !isFavorite && isMaxFavoritesReached;

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        {/* Header row with name and favorite */}
        <View style={styles.headerRow}>
          <View style={styles.nameContainer}>
            <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
              {facility.name}
            </Text>
          </View>
          {canShowFavorite && (
            <TouchableOpacity
              onPress={handleFavoritePress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              disabled={favoriteDisabled}
              style={[styles.favoriteButton, favoriteDisabled && styles.favoriteButtonDisabled]}
            >
              <Ionicons
                name={isFavorite ? 'heart' : 'heart-outline'}
                size={24}
                color={
                  isFavorite ? colors.error : favoriteDisabled ? colors.textMuted : colors.textMuted
                }
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Address row */}
        {addressText && (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={14} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} numberOfLines={1} style={styles.addressText}>
              {addressText}
            </Text>
          </View>
        )}

        {/* Distance, court count, and upcoming matches row */}
        {(distanceText || !!facility.court_count || !!facility.upcoming_match_count) && (
          <View style={styles.distanceRow}>
            {distanceText && (
              <>
                <Ionicons name="navigate-outline" size={14} color={colors.primary} />
                <Text size="sm" color={colors.primary} weight="medium">
                  {distanceText}
                </Text>
              </>
            )}
            {!!facility.court_count && (
              <>
                {distanceText && (
                  <Text size="sm" color={colors.textMuted} style={styles.dotSeparator}>
                    ·
                  </Text>
                )}
                <Ionicons name="grid-outline" size={13} color={colors.textMuted} />
                <Text size="sm" color={colors.textMuted}>
                  {facility.court_count === 1
                    ? t('facilitiesTab.badges.courtCountSingular')
                    : t('facilitiesTab.badges.courtCount').replace(
                        '{count}',
                        String(facility.court_count)
                      )}
                </Text>
              </>
            )}
            {!!facility.upcoming_match_count && (
              <>
                {(distanceText || !!facility.court_count) && (
                  <Text size="sm" color={colors.textMuted} style={styles.dotSeparator}>
                    ·
                  </Text>
                )}
                <SportIcon sportName={sportName ?? 'tennis'} size={13} color={colors.primary} />
                <Text size="sm" color={colors.primary} weight="medium">
                  {facility.upcoming_match_count === 1
                    ? t('facilitiesTab.badges.upcomingMatchCountSingular')
                    : t('facilitiesTab.badges.upcomingMatchCount').replace(
                        '{count}',
                        String(facility.upcoming_match_count)
                      )}
                </Text>
              </>
            )}
          </View>
        )}

        {/* Badges row */}
        {(facility.is_first_come_first_serve ||
          (facility.booking_url_template && facility.external_provider_id) ||
          facility.membership_required) && (
          <View style={styles.badgesRow}>
            {facility.is_first_come_first_serve && (
              <View style={[styles.badge, { backgroundColor: colors.primary + '18' }]}>
                <Ionicons name="walk-outline" size={12} color={colors.primary} />
                <Text size="xs" color={colors.primary} weight="medium">
                  {t('facilitiesTab.badges.firstComeFirstServe')}
                </Text>
              </View>
            )}
            {facility.booking_url_template && facility.external_provider_id && (
              <View style={[styles.badge, { backgroundColor: colors.primary + '18' }]}>
                <Ionicons name="calendar-outline" size={12} color={colors.primary} />
                <Text size="xs" color={colors.primary} weight="medium">
                  {t('facilitiesTab.badges.bookable')}
                </Text>
              </View>
            )}
            {facility.membership_required && (
              <View style={[styles.badge, { backgroundColor: '#f59e0b18' }]}>
                <Ionicons name="card-outline" size={12} color="#d97706" />
                <Text size="xs" color="#d97706" weight="medium">
                  {t('facilitiesTab.badges.membershipRequired')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Skeleton slots while loading */}
        {slotsLoading && !facility.is_first_come_first_serve && (
          <SlotSkeleton color={colors.border} />
        )}

        {/* Date-sectioned slots with horizontal scroll */}
        {slotsByDate.length > 0 && !slotsLoading && !facility.is_first_come_first_serve && (
          <ScrollView
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
                  color={dateGroup.isToday ? colors.primary : colors.textMuted}
                  style={styles.dateLabel}
                >
                  {dateGroup.dateLabel}
                </Text>
                <View style={styles.dateSlotsRow}>
                  {dateGroup.slots.map((slot, index) => {
                    const isTappable = !!slot.bookingUrl || !!slot.isLocalSlot;
                    return (
                      <TouchableOpacity
                        key={`${slot.facilityScheduleId}-${index}`}
                        style={[
                          styles.slotChip,
                          {
                            backgroundColor: isTappable
                              ? `${colors.primary}15`
                              : isDark
                                ? '#262626'
                                : '#f5f5f5',
                            borderColor: isTappable ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => isTappable && handleSlotPress(slot)}
                        disabled={!isTappable}
                        activeOpacity={0.7}
                      >
                        <Text
                          size="xs"
                          weight="medium"
                          color={isTappable ? colors.primary : colors.textMuted}
                        >
                          {slot.time}
                        </Text>
                        {slot.isLocalSlot ? (
                          <Ionicons name="business-outline" size={10} color={colors.primary} />
                        ) : (
                          slot.courtCount > 0 && (
                            <View
                              style={[
                                styles.courtCountBadge,
                                {
                                  backgroundColor: isTappable
                                    ? colors.primary
                                    : isDark
                                      ? colors.border
                                      : colors.textMuted,
                                },
                              ]}
                            >
                              <Text
                                size="xs"
                                weight="bold"
                                color={isTappable ? '#fff' : colors.card}
                                style={styles.courtCountText}
                              >
                                {slot.courtCount}
                              </Text>
                            </View>
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Empty state when no slots available */}
        {slotsByDate.length === 0 && !slotsLoading && !facility.is_first_come_first_serve && (
          <View style={styles.emptySlots}>
            <Ionicons name="calendar-clear-outline" size={14} color={colors.textMuted} />
            <Text size="xs" color={colors.textMuted}>
              {t('matchCreation.booking.noSlotsAvailable' as TranslationKey)}
            </Text>
          </View>
        )}
      </View>

      {/* Chevron indicator */}
      <View style={styles.chevronContainer}>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  content: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[1],
  },
  nameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  favoriteButton: {
    padding: spacingPixels[1],
  },
  favoriteButtonDisabled: {
    opacity: 0.5,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginBottom: spacingPixels[1],
  },
  addressText: {
    flex: 1,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  dotSeparator: {
    marginHorizontal: 2,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[1],
    marginTop: spacingPixels[2],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 3,
    borderRadius: radiusPixels.full,
  },
  chevronContainer: {
    marginLeft: spacingPixels[2],
  },
  slotsSkeletonRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    marginTop: spacingPixels[2],
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
    marginTop: spacingPixels[2],
    paddingVertical: spacingPixels[1],
  },
});
