import React, { useMemo } from 'react';
import { View, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, IconButton } from '@rallia/shared-components';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import {
  spacingPixels,
  radiusPixels,
  status,
  primary,
  secondary,
  accent,
  shadowsNative,
  shadowsNativeDark,
} from '@rallia/design-system';
import { TIER_COLORS } from '@rallia/shared-services';
import type { PlayerSearchResult, ReputationDisplay } from '@rallia/shared-services';

import RatingBadge from '#/components/RatingBadge';
import { useTranslation, useThemeStyles } from '#/hooks';

interface PlayerCardProps {
  player: PlayerSearchResult;
  onPress: (player: PlayerSearchResult) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (playerId: string) => void;
  showFavorite?: boolean;
  reputationDisplay?: ReputationDisplay;
  /** Online status computed by parent from last_seen_at */
  isOnline?: boolean;
  /** When false, hides online / last-seen activity in the meta row. */
  showActivity?: boolean;
  /** Optional trailing icon button in the name row (e.g. remove from list). */
  trailingAction?: PlayerCardTrailingAction;
  /** Optional multiple trailing icon buttons (e.g. approve + decline). Takes
   *  precedence over trailingAction when provided. */
  trailingActions?: PlayerCardTrailingAction[];
}

export type PlayerCardTrailingAction = {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  accessibilityLabel: string;
  onPress: (player: PlayerSearchResult) => void;
};

function formatDistance(meters: number | null, nearbyLabel: string): string {
  if (meters === null || meters === undefined) return '';
  if (meters < 1000) return nearbyLabel;
  return `${(meters / 1000).toFixed(1)} km`;
}

export const PLAYER_CARD_AVATAR_SIZE = 52;
// Ring gap + stroke; the frame is always rendered so columns align with or without a tier.
const RING_GAP = 2;
const RING_WIDTH = 2.5;
export const PLAYER_CARD_AVATAR_FRAME = PLAYER_CARD_AVATAR_SIZE + 2 * (RING_GAP + RING_WIDTH);
const MEDAL_SIZE = 20;
// Brand palettes rotated per player so photo-less cards still carry color.
const AVATAR_PALETTES = [primary, secondary, accent] as const;

function paletteFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

function initialsOf(first: string, last: string): string {
  return `${first.trim().charAt(0)}${last.trim().charAt(0)}`.toUpperCase() || '?';
}

const CERTIFICATION_LABEL_KEY = {
  self_declared: 'profile.certification.badge.selfDeclared',
  certified: 'profile.certification.badge.certified',
  disputed: 'profile.certification.badge.disputed',
} as const;

const ONLINE_DOT_SIZE = 12;
const ONLINE_DOT_BORDER = 2;
// Matches the sm Text line height so rows with and without a chip stay equal.
const META_ROW_MIN_HEIGHT = 21;
// IconButton size="sm" is 32pt; pin the row so cards without a heart match.
const NAME_ROW_MIN_HEIGHT = 32;

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  onPress,
  isFavorite = false,
  onToggleFavorite,
  showFavorite = false,
  reputationDisplay,
  isOnline = false,
  showActivity = true,
  trailingAction,
  trailingActions,
}) => {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();

  const displayName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Unknown';
  const distanceText = formatDistance(player.distance_meters, t('playerDirectory.nearby'));
  // Distance wins; the home city stands in when the searcher has no location.
  const placeText = distanceText || player.city || '';

  const showReputation = !!reputationDisplay?.isVisible;
  const onlineColor = isDark ? status.success.light : status.success.DEFAULT;
  const avatarPalette = paletteFor(player.id);
  const cardShadow = isDark ? shadowsNativeDark.md : shadowsNative.md;
  const tierColors = showReputation
    ? (TIER_COLORS[reputationDisplay.tier] ?? TIER_COLORS.unknown)
    : null;

  const resolvedTrailingActions = trailingActions ?? (trailingAction ? [trailingAction] : []);

  // Calendar-day "last active" label; hidden past 14 days so the row stays useful.
  const lastSeenLabel = useMemo(() => {
    if (!showActivity || isOnline || !player.last_seen_at) return null;
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
  }, [showActivity, isOnline, player.last_seen_at, t]);

  const showOnline = showActivity && isOnline;
  const activityText = showOnline ? t('playerDirectory.online') : lastSeenLabel;
  const hasMeta = !!placeText || !!activityText;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        cardShadow,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      onPress={() => onPress(player)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`View ${displayName}'s profile`}
    >
      <View
        style={[
          styles.avatarFrame,
          { borderColor: tierColors ? tierColors.primary : 'transparent' },
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
              { backgroundColor: isDark ? avatarPalette[900] : avatarPalette[100] },
            ]}
          >
            <Text size="lg" weight="bold" color={isDark ? avatarPalette[200] : avatarPalette[700]}>
              {initialsOf(player.first_name || '', player.last_name || '')}
            </Text>
          </View>
        )}
        {showOnline && (
          <View
            style={[styles.onlineDot, { backgroundColor: onlineColor, borderColor: colors.card }]}
          />
        )}
        {tierColors && (
          <View
            style={[
              styles.medal,
              { backgroundColor: tierColors.primary, borderColor: colors.card },
            ]}
            accessibilityLabel={reputationDisplay?.tierLabel}
          >
            <Ionicons name="shield" size={11} color={tierColors.background} />
          </View>
        )}
      </View>

      <View style={styles.infoContainer}>
        <View style={styles.nameRow}>
          <Text
            size="lg"
            weight="bold"
            color={colors.text}
            numberOfLines={1}
            style={styles.nameText}
          >
            {displayName}
          </Text>
          {(showFavorite && onToggleFavorite) || resolvedTrailingActions.length > 0 ? (
            <View style={styles.actions}>
              {showFavorite && onToggleFavorite && (
                <IconButton
                  size="sm"
                  accessibilityLabel={
                    isFavorite
                      ? t('playerDirectory.favorites.removeFromFavorites')
                      : t('playerDirectory.favorites.addToFavorites')
                  }
                  icon={
                    <Ionicons
                      name={isFavorite ? 'heart' : 'heart-outline'}
                      size={20}
                      color={isFavorite ? colors.error : colors.iconMuted}
                    />
                  }
                  onPress={() => onToggleFavorite(player.id)}
                />
              )}
              {resolvedTrailingActions.map(action => (
                <IconButton
                  key={action.icon}
                  size="sm"
                  accessibilityLabel={action.accessibilityLabel}
                  icon={
                    <Ionicons
                      name={action.icon}
                      size={20}
                      color={action.color ?? colors.iconMuted}
                    />
                  }
                  onPress={() => action.onPress(player)}
                />
              ))}
            </View>
          ) : null}
        </View>

        {hasMeta && (
          <View style={styles.metaRow}>
            {!!placeText && (
              <Text size="sm" color={colors.textMuted} numberOfLines={1} style={styles.metaShrink}>
                {placeText}
              </Text>
            )}
            {!!placeText && !!activityText && (
              <Text size="sm" color={colors.textMuted}>
                ·
              </Text>
            )}
            {!!activityText && (
              <Text
                size="sm"
                weight={showOnline ? 'semibold' : 'regular'}
                color={showOnline ? onlineColor : colors.textMuted}
                numberOfLines={1}
                style={styles.metaShrink}
              >
                {activityText}
              </Text>
            )}
          </View>
        )}
      </View>

      {player.rating && (
        <View style={styles.ratingColumn}>
          <RatingBadge
            variant="numeral"
            ratingValue={player.rating.value}
            ratingLabel={player.rating.label}
            certificationStatus={player.rating.badge_status}
            statusLabel={t(CERTIFICATION_LABEL_KEY[player.rating.badge_status])}
            isDark={isDark}
          />
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  avatarFrame: {
    width: PLAYER_CARD_AVATAR_FRAME,
    height: PLAYER_CARD_AVATAR_FRAME,
    borderRadius: PLAYER_CARD_AVATAR_FRAME / 2,
    borderWidth: RING_WIDTH,
    padding: RING_GAP,
    flexShrink: 0,
  },
  medal: {
    position: 'absolute',
    right: -RING_WIDTH - 1,
    bottom: -RING_WIDTH - 1,
    width: MEDAL_SIZE,
    height: MEDAL_SIZE,
    borderRadius: MEDAL_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: PLAYER_CARD_AVATAR_SIZE,
    height: PLAYER_CARD_AVATAR_SIZE,
    borderRadius: PLAYER_CARD_AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    width: PLAYER_CARD_AVATAR_SIZE,
    height: PLAYER_CARD_AVATAR_SIZE,
    borderRadius: PLAYER_CARD_AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    right: -RING_WIDTH,
    top: -RING_WIDTH,
    width: ONLINE_DOT_SIZE,
    height: ONLINE_DOT_SIZE,
    borderRadius: ONLINE_DOT_SIZE / 2,
    borderWidth: ONLINE_DOT_BORDER,
  },
  infoContainer: {
    flex: 1,
    minWidth: 0,
    gap: spacingPixels[0.5],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    minHeight: NAME_ROW_MIN_HEIGHT,
  },
  nameText: {
    flexShrink: 1,
    minWidth: 0,
  },
  ratingColumn: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    minHeight: META_ROW_MIN_HEIGHT,
  },
  metaShrink: {
    flexShrink: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
});

export default PlayerCard;
