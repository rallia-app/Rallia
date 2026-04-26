/**
 * PowerPairCard
 *
 * Best doubles duo in the network.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, radiusPixels, spacingPixels, status } from '@rallia/design-system';
import type { NetworkPulsePowerPair } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';

interface PowerPairCardProps {
  pair: NetworkPulsePowerPair;
}

export function PowerPairCard({ pair }: PowerPairCardProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  return (
    <View style={styles.section}>
      <Text size="sm" weight="bold" style={[styles.title, { color: colors.text }]}>
        {t('groups.leaderboard.discover.powerPairTitle')}
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <View style={styles.avatars}>
          <View style={[styles.avatar, { backgroundColor: isDark ? neutral[800] : neutral[200] }]}>
            <Ionicons name="person-outline" size={18} color={colors.textMuted} />
          </View>
          <View
            style={[
              styles.avatar,
              styles.avatarOverlap,
              { backgroundColor: isDark ? neutral[800] : neutral[200] },
            ]}
          >
            <Ionicons name="person-outline" size={18} color={colors.textMuted} />
          </View>
        </View>
        <View style={{ flex: 1, marginLeft: spacingPixels[3] }}>
          <Text size="sm" weight="semibold" style={{ color: colors.text }}>
            {pair.a_first_name} + {pair.b_first_name}
          </Text>
          <Text size="xs" style={{ color: colors.textMuted, marginTop: 2 }}>
            {t('groups.leaderboard.discover.powerPairCopy', {
              a: pair.a_first_name,
              b: pair.b_first_name,
              wins: pair.wins,
              losses: pair.losses,
            })}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: `${status.success.DEFAULT}22` }]}>
          <Text size="xs" weight="bold" style={{ color: status.success.DEFAULT }}>
            {pair.wins}–{pair.losses}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[4],
  },
  title: {
    marginBottom: spacingPixels[2],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlap: {
    marginLeft: -10,
  },
  badge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
});

export default PowerPairCard;
