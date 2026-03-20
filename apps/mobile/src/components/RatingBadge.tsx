import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';

export const CERTIFICATION_BADGE_COLORS: Record<
  'self_declared' | 'certified' | 'disputed',
  { bg: string; icon: string }
> = {
  self_declared: { bg: '#FFC107', icon: 'help-circle' },
  certified: { bg: '#4CAF50', icon: 'checkmark-circle' },
  disputed: { bg: '#F44336', icon: 'alert-circle' },
};

interface RatingBadgeProps {
  /** Numeric rating value (e.g., 3.5) — takes priority over ratingLabel */
  ratingValue?: number | null;
  /** Text rating label (e.g., "Advanced") — used as fallback */
  ratingLabel?: string | null;
  /** Certification status — affects badge colors */
  certificationStatus?: 'self_declared' | 'certified' | 'disputed' | null;
  /** Whether the app is in dark mode */
  isDark: boolean;
  /** Optional size variant */
  size?: 'sm' | 'md';
  /** Whether the badge is loading */
  isLoading?: boolean;
}

const RatingBadge: React.FC<RatingBadgeProps> = ({
  ratingValue,
  ratingLabel,
  certificationStatus,
  isDark,
  size = 'md',
  isLoading = false,
}) => {
  const height = size === 'sm' ? 20 : 24;

  // Show skeleton while loading
  if (isLoading) {
    return (
      <Skeleton
        width={60}
        height={height}
        borderRadius={radiusPixels.full}
        backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
        highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
      />
    );
  }

  const ratingDisplay =
    ratingValue !== undefined && ratingValue !== null ? ratingValue.toFixed(1) : ratingLabel;

  if (!ratingDisplay) return null;

  const certBadgeColors =
    certificationStatus && certificationStatus !== 'self_declared'
      ? CERTIFICATION_BADGE_COLORS[certificationStatus]
      : null;

  const badgeBg = certBadgeColors
    ? `${certBadgeColors.bg}25`
    : isDark
      ? `${primary[400]}30`
      : `${primary[500]}15`;

  const badgeTextColor = certBadgeColors
    ? certBadgeColors.bg
    : isDark
      ? primary[400]
      : primary[500];

  const badgeIcon = certBadgeColors
    ? (certBadgeColors.icon as keyof typeof Ionicons.glyphMap)
    : 'analytics';

  const iconSize = size === 'sm' ? 10 : 12;

  return (
    <View style={[styles.badge, { backgroundColor: badgeBg }]}>
      <Ionicons name={badgeIcon} size={iconSize} color={badgeTextColor} />
      <Text size="xs" weight="semibold" color={badgeTextColor}>
        {ratingDisplay}
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

export default RatingBadge;
