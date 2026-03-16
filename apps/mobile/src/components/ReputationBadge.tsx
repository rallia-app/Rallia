import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { TIER_COLORS } from '@rallia/shared-services';
import type { ReputationDisplay } from '@rallia/shared-services';

interface ReputationBadgeProps {
  /** Reputation display object from usePlayerReputation hook */
  reputationDisplay: ReputationDisplay;
  /** Whether the app is in dark mode */
  isDark: boolean;
  /** Optional size variant */
  size?: 'sm' | 'md';
}

const ReputationBadge: React.FC<ReputationBadgeProps> = ({
  reputationDisplay,
  isDark,
  size = 'md',
}) => {
  if (!reputationDisplay.isVisible) return null;

  const tierKey = reputationDisplay.tier as keyof typeof TIER_COLORS;
  const tierPalette = TIER_COLORS[tierKey] ?? TIER_COLORS.unknown;

  const bgColor = isDark ? tierPalette.text : tierPalette.background;
  const textColor = isDark ? tierPalette.background : tierPalette.text;
  const iconSize = size === 'sm' ? 10 : 12;

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Ionicons
        name={reputationDisplay.tierIcon as keyof typeof Ionicons.glyphMap}
        size={iconSize}
        color={textColor}
      />
      <Text size="xs" weight="semibold" color={textColor}>
        {reputationDisplay.tierLabel}
      </Text>
    </View>
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
  },
});

export { ReputationBadge };
export default ReputationBadge;
