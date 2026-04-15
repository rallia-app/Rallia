import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import { useTranslation, type TranslationKey } from '../hooks';
import { isBetaExpired } from '../constants/beta';

interface BetaBadgeProps {
  isDark: boolean;
}

const BetaBadge: React.FC<BetaBadgeProps> = ({ isDark }) => {
  const { t } = useTranslation();

  if (isBetaExpired()) return null;

  const baseColor = isDark ? accent[400] : accent[500];
  const bgColor = `${baseColor}25`;

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Ionicons name="flask-outline" size={10} color={baseColor} />
      <Text size="xs" weight="semibold" color={baseColor}>
        {t('beta.badge' as TranslationKey)}
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
    marginTop: 4,
  },
});

export default BetaBadge;
