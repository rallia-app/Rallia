import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import { isCoveted } from '@rallia/shared-utils';
import { useTranslation, type TranslationKey } from '../hooks';

interface CovetedBadgeProps {
  /** Reputation score (0-100) */
  reputationScore?: number;
  /** Certification status */
  certificationStatus?: string | null;
  /** Whether the app is in dark mode */
  isDark: boolean;
  /** Optional size variant */
  size?: 'sm' | 'md';
  /** Whether the badge is loading */
  isLoading?: boolean;
}

const CovetedBadge: React.FC<CovetedBadgeProps> = ({
  reputationScore,
  certificationStatus,
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

  if (!isCoveted(reputationScore, certificationStatus ?? undefined)) return null;

  const baseColor = isDark ? accent[400] : accent[500];
  const bgColor = `${baseColor}25`;
  const iconSize = size === 'sm' ? 10 : 12;

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Ionicons name="star" size={iconSize} color={baseColor} />
      <Text size="xs" weight="semibold" color={baseColor}>
        {t('match.tier.topPlayer' as TranslationKey)}
      </Text>
    </View>
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
    marginBottom: spacingPixels[1],
  },
});

export default CovetedBadge;
