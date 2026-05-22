/**
 * FacilityCard Component
 * Displays a facility in a card format with name, address, distance,
 * availability preview, and favorite toggle.
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Animated, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  primary,
  status,
  lightTheme,
  darkTheme,
} from '@rallia/design-system';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { lightHaptic } from '@rallia/shared-utils';
import { formatInlineSnapshotSlots, type FormattedSlot } from '@rallia/shared-hooks';
import { useAuth } from '../../../context';
import { useRequireOnboarding, useThemeStyles } from '../../../hooks';
import { SportIcon } from '../../../components/SportIcon';
import * as Analytics from '../../../services/analytics';
import type { TranslationKey, TranslationOptions } from '../../../hooks';

interface FacilityCardProps {
  facility: FacilitySearchResult;
  isFavorite: boolean;
  /** Invoked with the facility — keeps the caller's onPress stable across rows. */
  onPress: (facility: FacilitySearchResult) => void;
  onToggleFavorite: (facility: FacilitySearchResult) => void;
  isMaxFavoritesReached: boolean;
  /** When false, the favorite heart is hidden (e.g. signed out or not onboarded). When undefined, falls back to isAuthenticated. */
  showFavoriteButton?: boolean;
  /** Sport name for filtering provider availability (e.g., "tennis") */
  sportName?: string;
  /** Callback when a slot is pressed - receives facility and slot for court selection handling */
  onSlotPress?: (facility: FacilitySearchResult, slot: FormattedSlot) => void;
  /**
   * Kept for API parity with existing callers. The card derives its own
   * theme-aware surface internally (mirrors PlayerCard / MatchCard), so these
   * props no longer influence the card's framing.
   */
  isDark?: boolean;
  colors?: {
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

function FacilityCard({
  facility,
  isFavorite,
  onPress,
  onToggleFavorite,
  isMaxFavoritesReached,
  showFavoriteButton,
  sportName,
  onSlotPress,
  t,
}: FacilityCardProps) {
  const { isAuthenticated } = useAuth();
  const { guardAction } = useRequireOnboarding();
  const { isDark } = useThemeStyles();
  const canShowFavorite = showFavoriteButton !== undefined ? showFavoriteButton : isAuthenticated;

  // Derive theme/tier colors using the exact same pattern as PlayerCard /
  // MatchCard so the three card surfaces stay visually identical.
  const themeColors = isDark ? darkTheme : lightTheme;
  const cardBackground = isDark ? primary[950] : primary[50];
  const dynamicBorderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const textColor = themeColors.foreground;
  const mutedColor = themeColors.mutedForeground;
  const tierAccent = isDark ? primary[400] : primary[500];
  const successColor = isDark ? status.success.light : status.success.DEFAULT;
  const warningColor = isDark ? status.warning.light : status.warning.DEFAULT;

  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const handlePress = useCallback(() => {
    onPress(facility);
  }, [onPress, facility]);

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

  const handleFavoritePress = useCallback(() => {
    lightHaptic();
    onToggleFavorite(facility);
  }, [facility, onToggleFavorite]);

  const distanceText = formatDistance(facility.distance_meters);
  const addressText = [facility.address, facility.city].filter(Boolean).join(', ');

  // Court availability — inlined on the facility row by the search RPC.
  // Memoize the formatting pipeline so identical inputs (same JSONB array
  // reference) skip the filter/group/sort/map work entirely.
  const { slotsByDate } = useMemo(
    () => formatInlineSnapshotSlots(facility.availability_slots, facility.timezone),
    [facility.availability_slots, facility.timezone]
  );

  const handleSlotPress = useCallback(
    (slot: FormattedSlot) => {
      if (!slot.bookingUrl && !slot.isLocalSlot) return;
      lightHaptic();
      if (!guardAction()) return;
      if (onSlotPress) {
        onSlotPress(facility, slot);
      } else if (slot.bookingUrl) {
        Linking.openURL(slot.bookingUrl);
        Analytics.bookingRedirected({
          facility_id: facility.id,
          sport_id: 'unknown',
          sport_name: sportName ?? 'unknown',
          is_match_linked: false,
          source: 'facility_card',
        });
      }
    },
    [facility, onSlotPress, guardAction, sportName]
  );

  // Determine if favorite toggle should be disabled
  const favoriteDisabled = !isFavorite && isMaxFavoritesReached;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
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
          {/* Row 1: name + favorite */}
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
            {canShowFavorite && (
              <TouchableOpacity
                onPress={handleFavoritePress}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                disabled={favoriteDisabled}
                style={[styles.favoriteButton, favoriteDisabled && styles.favoriteButtonDisabled]}
              >
                <Ionicons
                  name={isFavorite ? 'heart' : 'heart-outline'}
                  size={20}
                  color={isFavorite ? '#EF4444' : mutedColor}
                />
              </TouchableOpacity>
            )}
          </View>

          {/* Row 2: address */}
          {addressText && (
            <View style={styles.addressRow}>
              <Ionicons name="location-outline" size={14} color={mutedColor} />
              <Text size="sm" color={mutedColor} numberOfLines={1} style={styles.addressText}>
                {addressText}
              </Text>
            </View>
          )}

          {/* Row 3: distance · court count · upcoming matches */}
          {(distanceText || !!facility.court_count || !!facility.upcoming_match_count) && (
            <View style={styles.distanceRow}>
              {distanceText && (
                <>
                  <Ionicons name="navigate-outline" size={14} color={tierAccent} />
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
                  <Ionicons name="grid-outline" size={13} color={mutedColor} />
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
              {!!facility.upcoming_match_count && (
                <>
                  {(distanceText || !!facility.court_count) && (
                    <Text size="sm" color={mutedColor} style={styles.dotSeparator}>
                      ·
                    </Text>
                  )}
                  <SportIcon sportName={sportName ?? 'tennis'} size={13} color={tierAccent} />
                  <Text size="sm" color={tierAccent} weight="medium">
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

          {/* Row 4: badges */}
          {(facility.organization_nature ||
            facility.is_first_come_first_serve ||
            (facility.booking_url_template && facility.external_provider_id) ||
            facility.membership_required) && (
            <View style={styles.badgesRow}>
              {facility.organization_nature === 'public' && (
                <View style={[styles.badge, { backgroundColor: `${successColor}26` }]}>
                  <Ionicons name="business-outline" size={12} color={successColor} />
                  <Text size="xs" color={successColor} weight="medium">
                    {t('facilitiesTab.badges.public')}
                  </Text>
                </View>
              )}
              {facility.organization_nature === 'private' && (
                <View style={[styles.badge, { backgroundColor: `${warningColor}26` }]}>
                  <Ionicons name="lock-closed-outline" size={12} color={warningColor} />
                  <Text size="xs" color={warningColor} weight="medium">
                    {t('facilitiesTab.badges.private')}
                  </Text>
                </View>
              )}
              {facility.is_first_come_first_serve && (
                <View style={[styles.badge, { backgroundColor: `${tierAccent}26` }]}>
                  <Ionicons name="walk-outline" size={12} color={tierAccent} />
                  <Text size="xs" color={tierAccent} weight="medium">
                    {t('facilitiesTab.badges.firstComeFirstServe')}
                  </Text>
                </View>
              )}
              {facility.booking_url_template && facility.external_provider_id && (
                <View style={[styles.badge, { backgroundColor: `${tierAccent}26` }]}>
                  <Ionicons name="calendar-outline" size={12} color={tierAccent} />
                  <Text size="xs" color={tierAccent} weight="medium">
                    {t('facilitiesTab.badges.bookable')}
                  </Text>
                </View>
              )}
              {facility.membership_required && (
                <View style={[styles.badge, { backgroundColor: `${warningColor}26` }]}>
                  <Ionicons name="card-outline" size={12} color={warningColor} />
                  <Text size="xs" color={warningColor} weight="medium">
                    {t('facilitiesTab.badges.membershipRequired')}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Date-sectioned slots with horizontal scroll. Slots arrive
              inlined on the facility row from search_facilities_nearby, so
              there is no separate loading state for this card. */}
          {slotsByDate.length > 0 &&
            !facility.is_first_come_first_serve &&
            !!facility.external_provider_id && (
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
                      color={dateGroup.isToday ? tierAccent : mutedColor}
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
                            {slot.isLocalSlot ? (
                              <Ionicons name="business-outline" size={10} color={tierAccent} />
                            ) : (
                              slot.courtCount > 0 && (
                                <View
                                  style={[
                                    styles.courtCountBadge,
                                    {
                                      backgroundColor: isTappable ? tierAccent : mutedColor,
                                    },
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
          {slotsByDate.length === 0 &&
            !facility.is_first_come_first_serve &&
            !!facility.external_provider_id && (
              <View style={styles.emptySlots}>
                <Ionicons name="calendar-clear-outline" size={14} color={mutedColor} />
                <Text size="xs" color={mutedColor}>
                  {t('matchCreation.booking.noSlotsAvailable' as TranslationKey)}
                </Text>
              </View>
            )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default React.memo(FacilityCard);

const styles = StyleSheet.create({
  // Mirrors PlayerCard / MatchCard surface so all three card families look identical.
  card: {
    borderRadius: radiusPixels.xl,
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
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
    gap: spacingPixels[1],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  nameText: {
    flex: 1,
  },
  favoriteButton: {
    padding: spacingPixels[1],
    flexShrink: 0,
  },
  favoriteButtonDisabled: {
    opacity: 0.5,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
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
    marginTop: spacingPixels[1],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 3,
    borderRadius: radiusPixels.full,
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
