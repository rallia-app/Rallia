/**
 * FacilityCard Component
 * Displays a facility in a card format with name, address, distance,
 * availability preview, and favorite toggle.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { lightHaptic } from '@rallia/shared-utils';
import { useAuth } from '../../../context';
import type { TranslationKey, TranslationOptions } from '../../../hooks';

interface FacilityCardProps {
  facility: FacilitySearchResult;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: (facility: FacilitySearchResult) => void;
  isMaxFavoritesReached: boolean;
  /** When false, the favorite heart is hidden (e.g. signed out or not onboarded). When undefined, falls back to isAuthenticated. */
  showFavoriteButton?: boolean;
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
  colors,
}: FacilityCardProps) {
  const { isAuthenticated } = useAuth();
  const canShowFavorite = showFavoriteButton !== undefined ? showFavoriteButton : isAuthenticated;

  const handleFavoritePress = useCallback(() => {
    lightHaptic();
    onToggleFavorite(facility);
  }, [facility, onToggleFavorite]);

  const distanceText = formatDistance(facility.distance_meters);
  const addressText = facility.address || facility.city || '';

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

        {/* Distance row */}
        {distanceText && (
          <View style={styles.distanceRow}>
            <Ionicons name="navigate-outline" size={14} color={colors.primary} />
            <Text size="sm" color={colors.primary} weight="medium">
              {distanceText}
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
  chevronContainer: {
    marginLeft: spacingPixels[2],
  },
});
