/**
 * ReasonBadge
 *
 * Explains WHY a player is suggested (available at game time, responds fast,
 * played together, ...). Deliberately built with the exact visual recipe of
 * RatingBadge / ReputationBadge — vertical gradient, hairline border, pill
 * radius, xs semibold label — so a card's badges read as one family.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  primary,
  accent,
  secondary,
  status,
  neutral,
} from '@rallia/design-system';

export type ReasonKey =
  | 'playedTogether'
  | 'availableAtSlot'
  | 'responsive'
  | 'sameRating'
  | 'activeRecently'
  | 'favoriteFacility'
  | 'nearby';

/** Accent + icon per reason. Colors come from the design system scales. */
export const REASON_BADGE_CONFIG: Record<
  ReasonKey,
  { color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  playedTogether: { color: primary[600], icon: 'people' },
  availableAtSlot: { color: status.success.DEFAULT, icon: 'time' },
  // Rate, not speed — hence a "replies" icon rather than a lightning bolt.
  responsive: { color: status.info.DEFAULT, icon: 'checkmark-done' },
  sameRating: { color: primary[500], icon: 'git-compare' },
  activeRecently: { color: status.success.light, icon: 'pulse' },
  favoriteFacility: { color: accent[600], icon: 'location' },
  nearby: { color: secondary[500], icon: 'navigate' },
};

function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const a = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

interface ReasonBadgeProps {
  reason: ReasonKey;
  label: string;
  isDark: boolean;
  size?: 'sm' | 'md';
  /** Neutral "off" treatment — for toggleable filter chips in their unselected state. */
  muted?: boolean;
}

const ReasonBadge: React.FC<ReasonBadgeProps> = ({
  reason,
  label,
  isDark,
  size = 'sm',
  muted = false,
}) => {
  const { color, icon } = REASON_BADGE_CONFIG[reason];

  const gradientColors: [string, string] = muted
    ? ['transparent', 'transparent']
    : isDark
      ? [withAlpha(color, 0.32), withAlpha(color, 0.5)]
      : [withAlpha(color, 0.08), withAlpha(color, 0.22)];
  const borderColor = muted
    ? isDark
      ? neutral[600]
      : neutral[300]
    : isDark
      ? withAlpha(color, 0.55)
      : withAlpha(color, 0.3);
  const contentColor = muted
    ? isDark
      ? neutral[400]
      : neutral[500]
    : isDark
      ? withAlpha(color, 0.99)
      : color;
  const iconSize = size === 'sm' ? 10 : 12;

  return (
    <LinearGradient
      colors={gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[
        styles.badge,
        { borderColor, shadowColor: color, shadowOpacity: isDark || muted ? 0 : 0.22 },
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={contentColor} />
      <Text size="xs" weight="semibold" color={contentColor} style={styles.label}>
        {label}
      </Text>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[0.5],
    paddingHorizontal: spacingPixels[1.5],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  label: {
    letterSpacing: 0.2,
  },
});

export default ReasonBadge;
