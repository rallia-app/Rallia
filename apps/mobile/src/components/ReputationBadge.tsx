import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

const ReputationBadge: React.FC<ReputationBadgeProps> = ({
  reputationDisplay,
  isDark,
  size = 'md',
  isLoading = false,
  onInfoPress,
}) => {
  const height = size === 'sm' ? 20 : 24;

  // Show skeleton while loading
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
  const tierPalette = TIER_COLORS[tierKey] ?? TIER_COLORS.unknown;

  const bgColor = isDark ? tierPalette.text : tierPalette.background;
  const textColor = isDark ? tierPalette.background : tierPalette.text;
  const iconSize = size === 'sm' ? 10 : 12;

  const badge = (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Ionicons
        name={reputationDisplay.tierIcon as keyof typeof Ionicons.glyphMap}
        size={iconSize}
        color={textColor}
      />
      <Text size="xs" weight="semibold" color={textColor}>
        {reputationDisplay.tierLabel}
      </Text>
      {onInfoPress && (
        <Ionicons
          name="information-circle-outline"
          size={14}
          color={isDark ? neutral[400] : neutral[500]}
        />
      )}
    </View>
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
  },
});

export { ReputationBadge };
export default ReputationBadge;
