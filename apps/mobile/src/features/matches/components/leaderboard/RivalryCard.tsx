/**
 * RivalryCard
 *
 * "Rivalry of the week" — top H2H pair in the network.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, radiusPixels, spacingPixels } from '@rallia/design-system';
import type { NetworkPulseRivalry } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';

interface RivalryCardProps {
  rivalry: NetworkPulseRivalry;
  onPress?: () => void;
}

export function RivalryCard({ rivalry, onPress }: RivalryCardProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  return (
    <View style={styles.section}>
      <Text size="sm" weight="bold" style={[styles.title, { color: colors.text }]}>
        {t('groups.leaderboard.discover.rivalryTitle')}
      </Text>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <View style={styles.players}>
          <Player name={rivalry.a_first_name} score={rivalry.a_wins} isDark={isDark} />
          <View style={styles.vs}>
            <Text size="xs" weight="semibold" style={{ color: colors.textMuted }}>
              vs
            </Text>
          </View>
          <Player name={rivalry.b_first_name} score={rivalry.b_wins} isDark={isDark} />
        </View>
        <Text
          size="xs"
          style={{ color: colors.textMuted, marginTop: spacingPixels[2], textAlign: 'center' }}
        >
          {t('groups.leaderboard.discover.rivalryCopy', {
            matches: rivalry.matches,
            scoreA: rivalry.a_wins,
            scoreB: rivalry.b_wins,
          })}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

interface PlayerProps {
  name: string;
  score: number;
  isDark: boolean;
}

function Player({ name, score, isDark }: PlayerProps) {
  const { colors } = useThemeStyles();
  return (
    <View style={styles.player}>
      <View style={[styles.avatar, { backgroundColor: isDark ? neutral[800] : neutral[200] }]}>
        <Ionicons name="person-outline" size={20} color={colors.textMuted} />
      </View>
      <Text size="sm" weight="semibold" style={{ color: colors.text, marginTop: 4 }}>
        {name}
      </Text>
      <Text size="xl" weight="bold" style={{ color: colors.text, marginTop: 2 }}>
        {score}
      </Text>
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
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  players: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  player: {
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vs: {
    paddingHorizontal: spacingPixels[3],
  },
});

export default RivalryCard;
