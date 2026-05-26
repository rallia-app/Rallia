/**
 * RecapCard — Step 1 last-week stats.
 *
 *   ┌──────────────────────────────┐
 *   │   GOAL        PLAYED         │
 *   │   3            2             │
 *   └──────────────────────────────┘
 *   ● ● ●  (tennis-ball row, primary for played, neutral for missed)
 *
 * The "played" number color flexes based on the comparison:
 *   played > goal  → accent (gold, "beat")
 *   played = goal  → primary (teal, "met")
 *   played < goal  → secondary (coral, "miss")
 *
 * First-time player (lastWeekGoal == null) → the component renders nothing.
 * The caller (WelcomeRecapStep) decides whether to compose this card at all.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import {
  accent,
  primary,
  secondary,
  radiusPixels,
  spacingPixels,
  shadowsSemanticNative,
} from '@rallia/design-system';

import { useTranslation } from '#/hooks';

interface RecapCardProps {
  lastWeekGoal: number | null;
  lastWeekPlayed: number | null;
}

export function RecapCard({ lastWeekGoal, lastWeekPlayed }: RecapCardProps) {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();

  // First-time player — the wizard's caller should already be hiding this
  // card via a `lastWeekGoal != null` check, but guard defensively.
  if (lastWeekGoal == null) return null;

  const played = lastWeekPlayed ?? 0;
  const playedColor =
    played > lastWeekGoal ? accent[500] : played >= lastWeekGoal ? primary[600] : secondary[500];

  const total = Math.max(lastWeekGoal, played);

  return (
    <View>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.stat}>
          <Text style={[styles.label, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.step1.recapGoal')}
          </Text>
          <Text style={[styles.num, { color: colors.text }]}>{lastWeekGoal}</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.divider }]} />
        <View style={styles.stat}>
          <Text style={[styles.label, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.step1.recapPlayed')}
          </Text>
          <Text style={[styles.num, { color: playedColor }]}>{played}</Text>
        </View>
      </View>

      <View style={styles.ballsRow}>
        {Array.from({ length: total }, (_, i) => {
          const isPlayed = i < played;
          const isBonus = i >= lastWeekGoal;
          return (
            <View
              key={i}
              style={[
                styles.ball,
                { backgroundColor: colors.border, borderColor: colors.card },
                isPlayed && (isBonus ? styles.ballBonus : styles.ballPlayed),
                !isPlayed && styles.ballMissed,
              ]}
            >
              <Text style={styles.ballText}>🎾</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[5],
    paddingHorizontal: spacingPixels[6],
    marginHorizontal: spacingPixels[1],
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    ...shadowsSemanticNative.card,
  },
  stat: {
    alignItems: 'center',
  },
  divider: {
    width: 1,
    height: 60,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: spacingPixels[2],
  },
  num: {
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 52,
    letterSpacing: -1,
  },
  ballsRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: spacingPixels[4],
  },
  ball: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  ballPlayed: {
    backgroundColor: primary[600],
  },
  ballBonus: {
    backgroundColor: accent[500],
  },
  ballMissed: {
    opacity: 0.5,
  },
  ballText: {
    fontSize: 16,
  },
});
