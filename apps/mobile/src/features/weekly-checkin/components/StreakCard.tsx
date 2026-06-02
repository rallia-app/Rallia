/**
 * StreakCard — Step 1 hero card for the CHECK-IN STREAK.
 *
 * Single-signal card: tells the player "you've checked in N weeks in a row".
 * This is intentionally separated from goal-hit tracking (see GoalsCard) so
 * the two distinct metrics don't blur together in the player's mind:
 *
 *   • Streak = discipline (did you check in?)
 *   • Goals  = performance (did you actually play enough?)
 *
 *   ┌────────────────────────────────────────────────┐
 *   │  🔥  4                                         │
 *   │      WEEK CHECK-IN STREAK                      │
 *   │                                                │
 *   │  ❄️ 1 freeze saved · Earn 1 every 4 weeks      │
 *   └────────────────────────────────────────────────┘
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import {
  accent,
  primary,
  secondary,
  radiusPixels,
  shadowsSemanticNative,
  spacingPixels,
} from '@rallia/design-system';

import { useTranslation } from '#/hooks';

const COUNT_UP_DURATION_MS = 800;

interface StreakCardProps {
  currentStreak: number;
  freezeInventory: number;
}

export function StreakCard({ currentStreak, freezeInventory }: StreakCardProps) {
  const { t } = useTranslation();
  const { isDark } = useThemeStyles();
  const isFresh = currentStreak === 0;

  // Warm "fireplace" gradient — same identity in both modes.
  const gradientStops = isDark
    ? ([accent[900], `${secondary[800]}CC`] as const)
    : ([accent[100], `${secondary[200]}CC`] as const);
  const surfaceBorder = isDark ? accent[700] : accent[300];
  const numberColor = isDark ? accent[100] : accent[800];
  const heroLabelColor = isDark ? accent[300] : accent[700];
  const freezeTextColor = isDark ? primary[200] : primary[700];
  const freezeHintColor = isDark ? `${accent[200]}99` : `${accent[800]}88`;

  // Count-up animation on streak number
  const countAnim = useRef(new Animated.Value(0)).current;
  const [displayCount, setDisplayCount] = useState(0);
  useEffect(() => {
    const listener = countAnim.addListener(({ value }) => {
      setDisplayCount(Math.round(value));
    });
    Animated.timing(countAnim, {
      toValue: currentStreak,
      duration: COUNT_UP_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => countAnim.removeListener(listener);
  }, [currentStreak, countAnim]);

  const freezeLabel =
    freezeInventory === 0
      ? t('weeklyCheckIn.step1.freezeZero')
      : freezeInventory === 1
        ? t('weeklyCheckIn.step1.freezeOne')
        : t('weeklyCheckIn.step1.freezeCount', { count: freezeInventory });

  return (
    <View style={[styles.card, { borderColor: surfaceBorder }]}>
      <LinearGradient
        colors={gradientStops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.hero}>
        <Text style={styles.flame}>🔥</Text>
        {isFresh ? (
          <Text style={[styles.freshTitle, { color: numberColor }]}>
            {t('weeklyCheckIn.step1.streakTitleZero')}
          </Text>
        ) : (
          <View style={styles.heroText}>
            <Text style={[styles.bigNumber, { color: numberColor }]}>{displayCount}</Text>
            <Text style={[styles.heroLabel, { color: heroLabelColor }]}>
              {displayCount === 1
                ? t('weeklyCheckIn.step1.streakLabelOne')
                : t('weeklyCheckIn.step1.streakLabel')}
            </Text>
          </View>
        )}
      </View>

      {/* First-time user (streak 0) — show only the flame + title; no freeze
          footer (a "0 freezes saved" line reads as a negative, and the old
          invite line was dropped). Returning players see their freeze status. */}
      {!isFresh && (
        <View style={styles.footer}>
          <Text style={[styles.footerPrimary, { color: freezeTextColor }]}>❄️ {freezeLabel}</Text>
          <Text style={[styles.footerHint, { color: freezeHintColor }]}>
            {t('weeklyCheckIn.step1.freezeHint')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[3],
    overflow: 'hidden',
    ...shadowsSemanticNative.card,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  flame: {
    fontSize: 36,
    lineHeight: 40,
  },
  heroText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacingPixels[2],
  },
  bigNumber: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1.5,
    lineHeight: 46,
    fontVariant: ['tabular-nums'],
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    flexShrink: 1,
  },
  freshTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  footer: {
    marginTop: spacingPixels[3],
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  footerPrimary: {
    fontSize: 12,
    fontWeight: '700',
  },
  footerHint: {
    fontSize: 11,
    fontWeight: '500',
    flexShrink: 1,
  },
});
