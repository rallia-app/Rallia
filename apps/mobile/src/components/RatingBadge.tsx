import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';

export const CERTIFICATION_BADGE_COLORS: Record<
  'self_declared' | 'certified' | 'disputed',
  { bg: string; icon: string }
> = {
  self_declared: { bg: primary[500], icon: 'help-circle' },
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

const RatingBadge: React.FC<RatingBadgeProps> = ({
  ratingValue,
  ratingLabel,
  certificationStatus,
  isDark,
  size = 'md',
  isLoading = false,
  onInfoPress,
}) => {
  const height = size === 'sm' ? 20 : 24;

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

  const accentColor = certBadgeColors ? certBadgeColors.bg : isDark ? primary[400] : primary[500];

  const gradientColors = (
    isDark
      ? [withAlpha(accentColor, 0.32), withAlpha(accentColor, 0.5)]
      : [withAlpha(accentColor, 0.08), withAlpha(accentColor, 0.22)]
  ) as [string, string];

  const borderColor = isDark ? withAlpha(accentColor, 0.55) : withAlpha(accentColor, 0.3);

  const badgeIcon = certBadgeColors
    ? (certBadgeColors.icon as keyof typeof Ionicons.glyphMap)
    : 'analytics';

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
          shadowColor: accentColor,
          shadowOpacity: isDark ? 0 : 0.22,
        },
      ]}
    >
      <Ionicons name={badgeIcon} size={iconSize} color={accentColor} />
      <Text size="xs" weight="semibold" color={accentColor} style={styles.label}>
        {ratingDisplay}
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
        accessibilityLabel="Rating info"
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

export default RatingBadge;
