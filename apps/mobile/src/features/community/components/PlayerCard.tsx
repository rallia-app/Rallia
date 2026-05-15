import React, { useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, Image, Animated, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import {
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
  lightTheme,
  darkTheme,
} from '@rallia/design-system';
import type { PlayerSearchResult } from '@rallia/shared-services';
import type { ReputationDisplay } from '@rallia/shared-services';
import RatingBadge from '../../../components/RatingBadge';
import ReputationBadge from '../../../components/ReputationBadge';
import AvailabilityGrid from './AvailabilityGrid';
import { useTranslation, useThemeStyles } from '../../../hooks';

// Match MatchCard token usage: same background tier, same border alpha,
// same shadow / radius / spacing. Card surface comes from primary[50/950]
// (matches MatchCard's "regular" tier), not from theme.card.

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
  /** Kept for API parity with the rest of community list, but card derives its
   *  own theme-aware colors internally to stay aligned with MatchCard. */
  colors?: ThemeColors;
  onPress: (player: PlayerSearchResult) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (playerId: string) => void;
  showFavorite?: boolean;
  reputationDisplay?: ReputationDisplay;
  /** Online status computed by parent from last_seen_at */
  isOnline?: boolean;
}

function formatDistance(meters: number | null, nearbyLabel: string): string {
  if (meters === null || meters === undefined) return '';
  if (meters < 100) return nearbyLabel;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

const AVATAR_SIZE = 60;
const CARD_HORIZONTAL_MARGIN = spacingPixels[4]; // 16px each side — matches MatchCard
const CARD_PADDING = spacingPixels[4]; // 16px — matches MatchCard

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  onPress,
  isFavorite = false,
  onToggleFavorite,
  showFavorite = false,
  reputationDisplay,
  isOnline = false,
}) => {
  const { t } = useTranslation();
  // Use the app's theme context (not device colorScheme) — the rest of the
  // app honors a user-selected theme override, so `useColorScheme` would
  // disagree and render the card in the wrong mode.
  const { isDark } = useThemeStyles();

  const displayName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Unknown';
  const distanceText = formatDistance(player.distance_meters, t('playerDirectory.nearby'));

  const scaleAnim = useMemo(() => new Animated.Value(1), []);
  const pulseAnim = useMemo(() => new Animated.Value(1), []);

  // Soft opacity pulse on the online indicator. Runs only while online; reset
  // to fully opaque on cleanup so a re-mount or state flip starts clean.
  useEffect(() => {
    if (!isOnline) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      pulseAnim.setValue(1);
    };
  }, [isOnline, pulseAnim]);

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

  // Derive theme/tier colors using the exact same pattern as MatchCard.
  const themeColors = isDark ? darkTheme : lightTheme;
  const cardBackground = isDark ? primary[950] : primary[50];
  const dynamicBorderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const textColor = themeColors.foreground;
  const mutedColor = themeColors.mutedForeground;
  const tierAccent = isDark ? primary[400] : primary[500];
  // Match MatchCard's avatar treatment (slot border + glow).
  const avatarBorderColor = tierAccent;
  const onlineColor = isDark ? status.success.light : status.success.DEFAULT;

  const hasBadges = !!(player.rating || reputationDisplay?.isVisible);
  const hasAvailability = !!player.availability && Object.keys(player.availability).length > 0;

  // When the player isn't online, derive a calendar-day "last active" label.
  // Hidden when missing or stale beyond 14 days so the row doesn't carry
  // meaningless noise.
  const lastSeenLabel = useMemo(() => {
    if (isOnline || !player.last_seen_at) return null;
    const seen = new Date(player.last_seen_at);
    const now = new Date();
    if (seen.getTime() > now.getTime()) return null;

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfSeen = new Date(seen.getFullYear(), seen.getMonth(), seen.getDate()).getTime();
    const diffDays = Math.round((startOfToday - startOfSeen) / 86_400_000);

    if (diffDays <= 0) return t('playerDirectory.lastSeenToday');
    if (diffDays === 1) return t('playerDirectory.lastSeenYesterday');
    if (diffDays <= 14) return t('playerDirectory.lastSeenDaysAgo', { count: diffDays });
    return null;
  }, [isOnline, player.last_seen_at, t]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: cardBackground,
            borderColor: dynamicBorderColor,
          },
        ]}
        onPress={() => onPress(player)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={`View ${displayName}'s profile`}
      >
        <View style={styles.content}>
          {/* Avatar with primary-tinted ring + shadow — mirrors MatchCard slot */}
          <View style={styles.avatarSection}>
            <View
              style={[
                styles.avatarRing,
                {
                  borderColor: avatarBorderColor,
                  shadowColor: avatarBorderColor,
                },
              ]}
            >
              {player.profile_picture_url ? (
                <Image
                  source={{ uri: getProfilePictureUrl(player.profile_picture_url) ?? '' }}
                  style={styles.avatar}
                />
              ) : (
                <View
                  style={[
                    styles.avatarPlaceholder,
                    { backgroundColor: isDark ? neutral[700] : neutral[200] },
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={26}
                    color={isDark ? neutral[400] : neutral[500]}
                  />
                </View>
              )}
            </View>
          </View>

          {/* Info */}
          <View style={styles.infoContainer}>
            {/* Row 1: name + favorite */}
            <View style={styles.nameRow}>
              <Text
                size="base"
                weight="bold"
                color={textColor}
                numberOfLines={1}
                style={styles.nameText}
              >
                {displayName}
              </Text>
              {showFavorite && onToggleFavorite && (
                <TouchableOpacity
                  onPress={() => onToggleFavorite(player.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.favoriteButton}
                >
                  <Ionicons
                    name={isFavorite ? 'heart' : 'heart-outline'}
                    size={20}
                    color={isFavorite ? '#EF4444' : mutedColor}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* Row 2: distance · activity (inline, dot-separated) */}
            {(!!distanceText || isOnline || !!lastSeenLabel) && (
              <View style={styles.locationRow}>
                {!!distanceText && (
                  <>
                    <Ionicons name="location" size={13} color={mutedColor} />
                    <Text
                      size="sm"
                      color={mutedColor}
                      numberOfLines={1}
                      style={styles.locationDistance}
                    >
                      {distanceText}
                    </Text>
                  </>
                )}
                {!!distanceText && (isOnline || !!lastSeenLabel) && (
                  <Text size="sm" color={mutedColor}>
                    ·
                  </Text>
                )}
                {isOnline ? (
                  <View style={styles.onlineInline}>
                    <Animated.View
                      style={[
                        styles.onlineDot,
                        { backgroundColor: onlineColor, opacity: pulseAnim },
                      ]}
                    />
                    <Text size="sm" weight="semibold" color={onlineColor} numberOfLines={1}>
                      {t('playerDirectory.online')}
                    </Text>
                  </View>
                ) : lastSeenLabel ? (
                  <Text size="sm" color={mutedColor} numberOfLines={1} style={styles.activityText}>
                    {lastSeenLabel}
                  </Text>
                ) : null}
              </View>
            )}

            {/* Row 3: badges */}
            {hasBadges && (
              <View style={styles.badgesRow}>
                {player.rating && (
                  <RatingBadge
                    ratingValue={player.rating.value}
                    ratingLabel={player.rating.label}
                    certificationStatus={player.rating.badge_status}
                    isDark={isDark}
                    size="sm"
                  />
                )}
                {reputationDisplay && (
                  <ReputationBadge
                    reputationDisplay={reputationDisplay}
                    isDark={isDark}
                    size="sm"
                  />
                )}
              </View>
            )}
          </View>
        </View>

        {/* Full-width availability section beneath the avatar/info row */}
        {hasAvailability && (
          <View style={styles.availabilitySection}>
            <AvailabilityGrid
              availability={player.availability}
              activeColor={tierAccent}
              mutedColor={mutedColor}
            />
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // Mirrors MatchCard styles.card exactly (sans minHeight — list density).
  card: {
    borderRadius: radiusPixels.xl,
    marginHorizontal: CARD_HORIZONTAL_MARGIN,
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
    flexDirection: 'row',
    alignItems: 'center',
    padding: CARD_PADDING,
    gap: spacingPixels[3],
  },
  avatarSection: {
    flexShrink: 0,
  },
  // Mirrors MatchCard's filled slot: 2px primary border + colored shadow.
  avatarRing: {
    borderRadius: (AVATAR_SIZE + 4) / 2,
    borderWidth: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContainer: {
    flex: 1,
    minWidth: 0,
    gap: spacingPixels[0.5],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  nameText: {
    flex: 1,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  locationDistance: {
    flexShrink: 1,
    minWidth: 0,
  },
  onlineInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    flexShrink: 0,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  activityText: {
    flexShrink: 1,
    minWidth: 0,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    flexWrap: 'wrap',
    marginTop: spacingPixels[1],
  },
  favoriteButton: {
    padding: spacingPixels[1],
    flexShrink: 0,
  },
  availabilitySection: {
    paddingHorizontal: CARD_PADDING,
    paddingBottom: CARD_PADDING,
  },
});

export default PlayerCard;
