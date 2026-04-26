/**
 * MatchupExtremesCard
 *
 * Shows the caller's "Bunny" (best matchup) and "Nemesis" (worst matchup).
 * Tapping either side fires onPress so the parent can open a comparison
 * overlay for that pair.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { radiusPixels, spacingPixels, status } from '@rallia/design-system';
import type { NetworkPulseMatchupExtreme } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';

interface MatchupExtremesCardProps {
  favorite: NetworkPulseMatchupExtreme | null;
  nemesis: NetworkPulseMatchupExtreme | null;
  onOpponentPress?: (opponentId: string) => void;
}

export function MatchupExtremesCard({
  favorite,
  nemesis,
  onOpponentPress,
}: MatchupExtremesCardProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  if (!favorite && !nemesis) return null;

  return (
    <View style={styles.section}>
      <Text size="sm" weight="bold" style={[styles.title, { color: colors.text }]}>
        {t('groups.leaderboard.discover.matchupExtremesTitle')}
      </Text>
      <View
        style={[styles.row, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
      >
        {favorite && (
          <Side
            tone="success"
            label={t('groups.leaderboard.discover.favorite')}
            extreme={favorite}
            onPress={() => favorite.opponent_id && onOpponentPress?.(favorite.opponent_id)}
          />
        )}
        {favorite && nemesis && (
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
        )}
        {nemesis && (
          <Side
            tone="error"
            label={t('groups.leaderboard.discover.nemesis')}
            extreme={nemesis}
            onPress={() => nemesis.opponent_id && onOpponentPress?.(nemesis.opponent_id)}
          />
        )}
      </View>
    </View>
  );
}

interface SideProps {
  tone: 'success' | 'error';
  label: string;
  extreme: NetworkPulseMatchupExtreme;
  onPress: () => void;
}

function Side({ tone, label, extreme, onPress }: SideProps) {
  const { colors } = useThemeStyles();
  const accent = tone === 'success' ? status.success.DEFAULT : status.error.DEFAULT;
  const icon = tone === 'success' ? 'happy-outline' : 'flame-outline';
  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={styles.side}>
      <View style={[styles.iconBubble, { backgroundColor: `${accent}22` }]}>
        <Ionicons name={icon} size={16} color={accent} />
      </View>
      <Text size="xs" weight="semibold" style={{ color: colors.textMuted, marginTop: 6 }}>
        {label.toUpperCase()}
      </Text>
      <Text size="sm" weight="semibold" style={{ color: colors.text, marginTop: 2 }}>
        {extreme.opponent_name}
      </Text>
      <Text size="xs" weight="bold" style={{ color: accent, marginTop: 2 }}>
        {extreme.wins}–{extreme.losses}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[4],
  },
  title: {
    marginBottom: spacingPixels[2],
  },
  row: {
    flexDirection: 'row',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  side: {
    flex: 1,
    alignItems: 'center',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MatchupExtremesCard;
