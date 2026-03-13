/**
 * PlayerCard Component
 *
 * Displays a player's basic info in a card format for the Player Directory.
 * Shows profile picture, name, city, sport-specific rating, and online status.
 * Includes press animation for tactile feedback.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Animated,
  TouchableWithoutFeedback,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, neutral } from '@rallia/design-system';
import type { PlayerSearchResult } from '@rallia/shared-services';
import { isPlayerOnline } from '@rallia/shared-services';
import { useTranslation, type TranslationKey } from '../../../hooks';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
}

interface PlayerCardProps {
  player: PlayerSearchResult;
  colors: ThemeColors;
  onPress: (player: PlayerSearchResult) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (playerId: string) => void;
  showFavorite?: boolean;
}

function formatDistance(meters: number | null, nearbyLabel: string): string {
  if (meters === null || meters === undefined) return '';
  if (meters < 100) {
    return nearbyLabel;
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Get level description based on rating value
 * Maps NTRP/DUPR rating values to skill level descriptions
 */
function getLevelDescription(value: number | null | undefined, t: (key: string) => string): string {
  if (value === null || value === undefined) return t('playerProfile.rating.unrated');
  if (value <= 2.0) return t('playerProfile.rating.beginner');
  if (value <= 3.0) return t('playerProfile.rating.intermediate');
  if (value <= 4.0) return t('playerProfile.rating.intermediateAdvanced');
  if (value <= 5.0) return t('playerProfile.rating.advanced');
  return t('playerProfile.rating.professional');
}

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  colors,
  onPress,
  isFavorite = false,
  onToggleFavorite,
  showFavorite = false,
}) => {
  const { t } = useTranslation();
  // Always use first + last name
  const displayName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Unknown';
  const distanceText = formatDistance(player.distance_meters, t('playerDirectory.nearby'));
  const [isOnline, setIsOnline] = useState(false);
  // Animation value - using useMemo for stable instance
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  // Get level description for the rating
  const levelDescription =
    player.rating?.value != null
      ? getLevelDescription(player.rating.value, t as (key: string) => string)
      : null;

  // Check online status
  useEffect(() => {
    if (player.id) {
      isPlayerOnline(player.id).then(setIsOnline);
    }
  }, [player.id]);

  // Press animation handlers
  const handlePressIn = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 0.97,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  return (
    <TouchableWithoutFeedback
      onPress={() => onPress(player)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          styles.container,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        {/* Favorite Button - Top Right */}
        {showFavorite && onToggleFavorite && (
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={() => onToggleFavorite(player.id)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={24}
              color={isFavorite ? '#EF4444' : colors.textMuted}
            />
          </TouchableOpacity>
        )}

        {/* Profile Picture with Online Indicator */}
        <View style={styles.avatarContainer}>
          {player.profile_picture_url ? (
            <Image source={{ uri: player.profile_picture_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
              <Ionicons name="person-outline" size={24} color={colors.textMuted} />
            </View>
          )}
          {/* Online Status Indicator */}
          <View
            style={[
              styles.onlineIndicator,
              { backgroundColor: isOnline ? '#22C55E' : neutral[400] },
            ]}
          />
        </View>

        {/* Player Info */}
        <View style={styles.infoContainer}>
          <View style={styles.nameRow}>
            <Text
              size="base"
              weight="semibold"
              color={colors.text}
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {displayName}
            </Text>
            {player.rating?.is_certified && (
              <View style={styles.certifiedBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#4CAF50" />
                <Text size="xs" weight="semibold" style={styles.certifiedBadgeText}>
                  {t('community.certified')}
                </Text>
              </View>
            )}
          </View>

          {(player.city || distanceText) && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={colors.textMuted} />
              <Text
                size="sm"
                color={colors.textMuted}
                style={styles.locationText}
                numberOfLines={1}
              >
                {[player.city, distanceText].filter(Boolean).join(' · ')}
              </Text>
            </View>
          )}

          {player.rating && (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color={colors.primary} />
              <Text
                size="sm"
                weight="medium"
                color={colors.textSecondary}
                style={styles.ratingText}
              >
                {player.rating.label}
                {levelDescription && ` (${levelDescription})`}
              </Text>
            </View>
          )}
        </View>

        {/* Chevron */}
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    position: 'relative',
  },
  favoriteButton: {
    position: 'absolute',
    top: spacingPixels[2],
    right: spacingPixels[1.5],
    padding: spacingPixels[1],
    zIndex: 1,
  },
  avatarContainer: {
    marginRight: spacingPixels[3],
    position: 'relative',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  infoContainer: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1],
  },
  locationText: {
    marginLeft: spacingPixels[1],
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1],
  },
  ratingText: {
    marginLeft: spacingPixels[1],
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  certifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#4CAF50',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
    gap: 3,
  },
  certifiedBadgeText: {
    color: '#4CAF50',
    fontSize: 10,
  },
});

export default PlayerCard;
