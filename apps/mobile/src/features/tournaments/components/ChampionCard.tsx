/**
 * ChampionCard
 *
 * Shared tournament champion display — one banner used by both the overview
 * and bracket tabs: trophy + label + gold-tinted name.
 */

import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { useTranslation } from '../../../hooks';

/** Subset of the screen's themed colours this card needs. */
export interface ChampionCardColors {
  championBg: string;
  championText: string;
}

interface ChampionCardProps {
  name: string;
  colors: ChampionCardColors;
  style?: StyleProp<ViewStyle>;
}

export const ChampionCard: React.FC<ChampionCardProps> = ({ name, colors, style }) => {
  const { t } = useTranslation();
  const label = t('tournamentDetail.dashboard.champion').toUpperCase();

  return (
    <View style={[styles.banner, { backgroundColor: colors.championBg }, style]}>
      <Ionicons name="trophy" size={24} color={colors.championText} />
      <View>
        <Text size="xs" weight="semibold" color={colors.championText}>
          {label}
        </Text>
        <Text size="lg" weight="bold" color={colors.championText}>
          {name}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    marginBottom: spacingPixels[5],
  },
});

export default ChampionCard;
