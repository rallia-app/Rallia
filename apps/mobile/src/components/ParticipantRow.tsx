/**
 * ParticipantRow
 *
 * Compact roster row for the Tournament / League detail screens. Designed to
 * sit inside those screens' Section cards (flat surface, hairline dividers,
 * 16px row padding) — deliberately quieter than the community PlayerCard.
 */

import React from 'react';
import { View, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { spacingPixels } from '@rallia/design-system';
import { getTierConfig } from '@rallia/shared-services';
import type {
  PlayerSearchResult,
  ReputationDisplay,
  ReputationTier,
} from '@rallia/shared-services';

import { useThemeStyles } from '#/hooks';

import RatingBadge from './RatingBadge';
import ReputationBadge from './ReputationBadge';

export type ParticipantRowAction = {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  accessibilityLabel: string;
  onPress: (player: PlayerSearchResult) => void;
};

/** Structural subset of both detail screens' ScreenColors. */
interface ParticipantRowColors {
  text: string;
  textMuted: string;
  border: string;
  statusMutedBg: string;
}

interface ParticipantRowProps {
  player: PlayerSearchResult;
  onPress: (player: PlayerSearchResult) => void;
  colors: ParticipantRowColors;
  trailingActions?: ParticipantRowAction[];
  /** Hairline separator above the row; set on every row after the first. */
  showDivider?: boolean;
}

// Mirror PlayerDirectory: derive reputation display straight from the row,
// no extra API call. Hidden unless the player's reputation is public.
function reputationDisplayFor(player: PlayerSearchResult): ReputationDisplay | undefined {
  if (!player.reputation_tier || !player.reputation_is_public) return undefined;
  const tier = player.reputation_tier as ReputationTier;
  const cfg = getTierConfig(tier);
  return {
    tier,
    score: player.reputation_score ?? 100,
    isVisible: player.reputation_is_public,
    tierLabel: cfg.label,
    tierColor: cfg.color,
    tierIcon: cfg.icon,
  };
}

const AVATAR_SIZE = 40;

const ParticipantRow: React.FC<ParticipantRowProps> = ({
  player,
  onPress,
  colors,
  trailingActions,
  showDivider,
}) => {
  const { isDark } = useThemeStyles();

  const displayName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Unknown';
  const avatarUri = getProfilePictureUrl(player.profile_picture_url);
  const reputationDisplay = reputationDisplayFor(player);
  const hasBadges = !!(player.rating || reputationDisplay);
  const actions = trailingActions ?? [];

  return (
    <TouchableOpacity
      onPress={() => onPress(player)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={displayName}
      style={[
        styles.row,
        showDivider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      ]}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
      ) : (
        <View
          style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.statusMutedBg }]}
        >
          <Ionicons name="person" size={18} color={colors.textMuted} />
        </View>
      )}

      <View style={styles.info}>
        <Text size="base" weight="medium" color={colors.text} numberOfLines={1}>
          {displayName}
        </Text>
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
              <ReputationBadge reputationDisplay={reputationDisplay} isDark={isDark} size="sm" />
            )}
          </View>
        )}
      </View>

      {actions.length > 0 ? (
        actions.map(action => (
          <TouchableOpacity
            key={action.icon}
            onPress={() => action.onPress(player)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel}
          >
            <Ionicons name={action.icon} size={20} color={action.color ?? colors.textMuted} />
          </TouchableOpacity>
        ))
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: spacingPixels[1],
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    flexWrap: 'wrap',
  },
  actionButton: {
    padding: spacingPixels[1],
    flexShrink: 0,
  },
});

export default ParticipantRow;
