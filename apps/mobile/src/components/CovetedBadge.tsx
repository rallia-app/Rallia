import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import { isCoveted } from '@rallia/shared-utils';

import { useTranslation, type TranslationKey } from '#/hooks';

interface CovetedBadgeProps {
  /** Reputation score (0-100) */
  reputationScore?: number;
  /** Certification status */
  certificationStatus?: string | null;
  /** Total reputation events for this player */
  totalEvents?: number;
  /** Whether the app is in dark mode */
  isDark: boolean;
  /** Optional size variant */
  size?: 'sm' | 'md';
  /** Whether the badge is loading */
  isLoading?: boolean;
}

function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const a = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

const CovetedBadge: React.FC<CovetedBadgeProps> = ({
  reputationScore,
  certificationStatus,
  totalEvents,
  isDark,
  size = 'md',
  isLoading = false,
}) => {
  const { t } = useTranslation();
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

  if (!isCoveted(reputationScore, certificationStatus ?? undefined, totalEvents)) return null;

  const accentColor = isDark ? accent[400] : accent[500];

  const gradientColors: [string, string] = isDark
    ? [withAlpha(accentColor, 0.32), withAlpha(accentColor, 0.5)]
    : [withAlpha(accentColor, 0.08), withAlpha(accentColor, 0.22)];

  const borderColor = isDark ? withAlpha(accentColor, 0.55) : withAlpha(accentColor, 0.3);

  const iconSize = size === 'sm' ? 10 : 12;

  return (
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
      <Ionicons name="star" size={iconSize} color={accentColor} />
      <Text size="xs" weight="semibold" color={accentColor} style={styles.label}>
        {t('match.tier.topPlayer')}
      </Text>
    </LinearGradient>
  );
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

export default CovetedBadge;
