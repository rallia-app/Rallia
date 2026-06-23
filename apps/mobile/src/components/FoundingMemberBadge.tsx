import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, secondary, neutral } from '@rallia/design-system';
import { isFoundingMember } from '@rallia/shared-utils';

import { useTranslation } from '#/hooks';

interface FoundingMemberBadgeProps {
  /** Player join timestamp (profile/player created_at) */
  createdAt?: string | null;
  /** Whether onboarding is complete — unknown (undefined) does not disqualify */
  onboardingCompleted?: boolean | null;
  /** Whether the app is in dark mode */
  isDark: boolean;
  /** Optional size variant */
  size?: 'sm' | 'md';
  /** Whether the badge is loading */
  isLoading?: boolean;
  /** Callback when the badge is pressed — shows an info icon when provided */
  onInfoPress?: () => void;
}

function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const a = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

const FoundingMemberBadge: React.FC<FoundingMemberBadgeProps> = ({
  createdAt,
  onboardingCompleted,
  isDark,
  size = 'md',
  isLoading = false,
  onInfoPress,
}) => {
  const { t } = useTranslation();
  const height = size === 'sm' ? 20 : 24;

  if (isLoading) {
    return (
      <Skeleton
        width={110}
        height={height}
        borderRadius={radiusPixels.full}
        backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
        highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
      />
    );
  }

  if (!isFoundingMember(createdAt, onboardingCompleted)) return null;

  const color = isDark ? secondary[400] : secondary[500];

  const gradientColors: [string, string] = isDark
    ? [withAlpha(color, 0.32), withAlpha(color, 0.5)]
    : [withAlpha(color, 0.08), withAlpha(color, 0.22)];

  const borderColor = isDark ? withAlpha(color, 0.55) : withAlpha(color, 0.3);
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
          shadowColor: color,
          shadowOpacity: isDark ? 0 : 0.22,
        },
      ]}
    >
      <Ionicons name="ribbon" size={iconSize} color={color} />
      <Text size="xs" weight="semibold" color={color} style={styles.label}>
        {t('playerBadges.foundingMember')}
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
        accessibilityLabel={t('playerBadges.foundingMember')}
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
    alignSelf: 'center',
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

export default FoundingMemberBadge;
