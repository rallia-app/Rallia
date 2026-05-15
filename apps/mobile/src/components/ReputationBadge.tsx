import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, neutral } from '@rallia/design-system';
import { TIER_COLORS } from '@rallia/shared-services';
import type { ReputationDisplay } from '@rallia/shared-services';

interface ReputationBadgeProps {
  /** Reputation display object from usePlayerReputation hook */
  reputationDisplay?: ReputationDisplay;
  /** Whether the app is in dark mode */
  isDark: boolean;
  /** Optional size variant */
  size?: 'sm' | 'md';
  /** Whether the badge is loading */
  isLoading?: boolean;
  /** Callback when info icon is pressed — shows info icon when provided */
  onInfoPress?: () => void;
}

function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const a = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

const ReputationBadge: React.FC<ReputationBadgeProps> = ({
  reputationDisplay,
  isDark,
  size = 'md',
  isLoading = false,
  onInfoPress,
}) => {
  const height = size === 'sm' ? 20 : 24;

  if (isLoading) {
    return (
      <Skeleton
        width={80}
        height={height}
        borderRadius={radiusPixels.full}
        backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
        highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
      />
    );
  }

  if (!reputationDisplay?.isVisible) return null;

  const tierKey = reputationDisplay.tier as keyof typeof TIER_COLORS;
  const tier = TIER_COLORS[tierKey] ?? TIER_COLORS.unknown;

  const gradientColors = (
    isDark
      ? [withAlpha(tier.primary, 0.4), tier.text]
      : [tier.background, withAlpha(tier.primary, 0.22)]
  ) as [string, string];

  const iconColor = isDark ? tier.background : tier.primary;
  const textColor = isDark ? tier.background : tier.text;
  const borderColor = isDark ? withAlpha(tier.primary, 0.55) : withAlpha(tier.primary, 0.32);
  const iconSize = size === 'sm' ? 10 : 12;

  const badge = (
    <LinearGradient
      colors={gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[
        styles.badge,
        {
          borderColor,
          shadowColor: tier.primary,
          shadowOpacity: isDark ? 0 : 0.22,
        },
      ]}
    >
      <Ionicons
        name={reputationDisplay.tierIcon as keyof typeof Ionicons.glyphMap}
        size={iconSize}
        color={iconColor}
      />
      <Text size="xs" weight="semibold" color={textColor} style={styles.label}>
        {reputationDisplay.tierLabel}
      </Text>
      {onInfoPress && (
        <Ionicons
          name="information-circle-outline"
          size={14}
          color={isDark ? neutral[400] : neutral[500]}
        />
      )}
    </LinearGradient>
  );

  if (onInfoPress) {
    return (
      <TouchableOpacity
        onPress={onInfoPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Reputation info"
      >
        {badge}
      </TouchableOpacity>
    );
  }

  return badge;
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

export { ReputationBadge };
export default ReputationBadge;
