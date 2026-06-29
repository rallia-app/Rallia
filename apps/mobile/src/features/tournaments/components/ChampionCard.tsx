/**
 * ChampionCard
 *
 * Celebratory tournament champion banner — gold gradient, trophy badge, and a
 * couple of sparkle accents. Used on both the overview and bracket tabs.
 */

import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';

import { useTranslation } from '../../../hooks';

/** Kept for call-site compatibility; the card now uses its own gold palette. */
export interface ChampionCardColors {
  championBg: string;
  championText: string;
}

interface ChampionCardProps {
  name: string;
  colors: ChampionCardColors;
  style?: StyleProp<ViewStyle>;
}

const WHITE = '#ffffff';

export const ChampionCard: React.FC<ChampionCardProps> = ({ name, style }) => {
  const { t } = useTranslation();
  const label = t('tournamentDetail.dashboard.champion').toUpperCase();

  return (
    <View style={[styles.shadow, style]}>
      <LinearGradient
        colors={[accent[400], accent[500], accent[600]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.banner}
      >
        {/* decorative sparkles */}
        <Ionicons
          name="sparkles"
          size={14}
          color="rgba(255,255,255,0.55)"
          style={styles.sparkleTop}
        />
        <Ionicons
          name="sparkles-outline"
          size={22}
          color="rgba(255,255,255,0.3)"
          style={styles.sparkleBottom}
        />

        <View style={styles.trophyCircle}>
          <Ionicons name="trophy" size={26} color={accent[700]} />
        </View>
        <View style={styles.textBlock}>
          <Text size="xs" weight="bold" color="rgba(255,255,255,0.9)" style={styles.overline}>
            {label}
          </Text>
          <Text size={22} weight="bold" color={WHITE} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Ionicons name="medal" size={22} color="rgba(255,255,255,0.9)" />
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  shadow: {
    marginBottom: spacingPixels[5],
    borderRadius: radiusPixels.xl,
    shadowColor: accent[600],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
  },
  trophyCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: { flex: 1 },
  overline: { letterSpacing: 1.2, marginBottom: 2 },
  sparkleTop: { position: 'absolute', top: 8, right: 16 },
  sparkleBottom: { position: 'absolute', bottom: 6, right: 84 },
});

export default ChampionCard;
