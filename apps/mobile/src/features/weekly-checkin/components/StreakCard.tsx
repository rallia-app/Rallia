/**
 * StreakCard — Step-1 recap hero: WEEKLY GOAL STREAK + goal-hit tracking.
 *
 * One warm "fireplace" card combining what used to be two:
 *   • the streak hero (🔥 N + "WEEKLY GOAL STREAK", or "Start a streak this week")
 *   • the freeze footer (returning players only)
 *   • goal tracking: last-week result + the 4-week hit/miss history strip
 *
 * The streak advances at week-end when sessions_played >= frequency_goal
 * (evaluate_weekly_goals). Any game the player joined and played counts as a
 * session — completing this weekly wizard does not itself advance the streak.
 * A freeze auto-rescues one miss.
 *
 * The strip shows the last 4 COMPLETED weeks, each rendered in its OWN slot by
 * its real date (historyWeeks from the RPC) — so a skipped week shows in place
 * instead of being hidden, and the streak number is self-evident. Markers are
 * four-state: ✓ hit, ❄️ missed-but-rescued (streak survived), ✗ missed-while-
 * checked-in (streak broke), and a dashed slot for a week with no check-in at
 * all (also a break). Weeks are labelled "month + week-of-month" (e.g. Jun /
 * Week 2) rather than a raw Monday date.
 *
 * Deliberately compact — the goal picker below must stay on screen without
 * scrolling, so everything is single-purpose: one hero row (streak + freeze
 * chip), one last-week line, one marker strip.
 *
 *   ┌────────────────────────────────────────────────┐
 *   │  🔥 1 WEEKLY GOAL STREAK              ❄️ ×0   │
 *   │  ────────────────────────────────────────────  │
 *   │  Last week: 8 played · goal 2  ✓               │
 *   │    ✗       ✓       ⬚       ✓                   │
 *   │   May     Jun     Jun     Jun                   │
 *   │  Week 4  Week 1  Week 2  Week 3                 │
 *   └────────────────────────────────────────────────┘
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import {
  accent,
  base,
  primary,
  secondary,
  radiusPixels,
  shadowsSemanticNative,
  spacingPixels,
} from '@rallia/design-system';

import { useTranslation } from '#/hooks';
import { useLocale } from '#/context';
import type { HistoryWeek } from '../api';

const COUNT_UP_DURATION_MS = 800;

interface StreakCardProps {
  currentStreak: number;
  freezeInventory: number;
  lastWeekGoal: number | null;
  lastWeekPlayed: number | null;
  /** Last 4 completed weeks (any order) from get_check_in_context, each with its
   *  real start date + status. Rendered by week, so gap weeks show in place. */
  historyWeeks: HistoryWeek[];
}

export function StreakCard({
  currentStreak,
  freezeInventory,
  lastWeekGoal,
  lastWeekPlayed,
  historyWeeks,
}: StreakCardProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
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
  const dateLabelColor = isDark ? `${accent[200]}99` : `${accent[800]}88`;
  const dividerColor = isDark ? `${accent[700]}66` : `${accent[300]}99`;
  const emptyBorderColor = isDark ? `${accent[300]}66` : `${accent[700]}55`;

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

  // ── Goal-hit history ──────────────────────────────────────────────────────
  // One marker per completed week, oldest-first (left-to-right). Each week keeps
  // its real date + status, so a no-check-in gap week shows in its true slot
  // instead of being hidden and the labels lining up with the marks.
  const monthFormatter = new Intl.DateTimeFormat(locale ?? 'en-US', { month: 'short' });
  const historyOldestFirst = [...historyWeeks].sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart)
  );
  const hasAnyHistory = historyWeeks.some(w => w.status !== 'none');

  const hasLastWeek = lastWeekGoal != null;
  const playedCount = lastWeekPlayed ?? 0;
  const lastWeekHit = hasLastWeek ? playedCount >= lastWeekGoal : false;
  const lastWeekStatusColor = lastWeekHit
    ? isDark
      ? primary[300]
      : primary[700]
    : isDark
      ? secondary[300]
      : secondary[600];
  // No streak AND no goal history at all → brand-new / rebaselined player.
  const isFirstTimeGoals = !hasAnyHistory && lastWeekGoal == null;

  return (
    <View style={[styles.card, { borderColor: surfaceBorder }]}>
      <LinearGradient
        colors={gradientStops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Hero row: streak + freeze-inventory chip (returning players only) */}
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
        {!isFresh && (
          <View
            style={[
              styles.freezeChip,
              { backgroundColor: isDark ? `${primary[700]}33` : primary[50] },
            ]}
            accessibilityLabel={freezeLabel}
          >
            <Text style={[styles.freezeChipText, { color: freezeTextColor }]}>
              ❄️ ×{freezeInventory}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.divider, { backgroundColor: dividerColor }]} />

      {/* Last week, goal-anchored — avoids the "4/3" broken-fraction read. */}
      {!isFirstTimeGoals && hasLastWeek && (
        <View style={styles.lastWeekRow}>
          <Text style={[styles.lastWeekLabel, { color: dateLabelColor }]}>
            {t('weeklyCheckIn.step1.goalsCardLastWeekResult', {
              played: playedCount,
              goal: lastWeekGoal,
            })}
          </Text>
          <Text style={[styles.lastWeekValue, { color: lastWeekStatusColor }]}>
            {lastWeekHit ? '✓' : '✗'}
          </Text>
        </View>
      )}

      {isFirstTimeGoals ? (
        <Text style={[styles.placeholder, { color: freezeHintColor }]}>
          {t('weeklyCheckIn.step1.goalsCardNoHistory')}
        </Text>
      ) : (
        hasAnyHistory && (
          <View style={styles.markersRow}>
            {historyOldestFirst.map(week => {
              const date = new Date(`${week.weekStart}T00:00:00`);
              return (
                <View key={week.weekStart} style={styles.markerCol}>
                  {week.status === 'frozen' ? (
                    // Missed but a freeze rescued it — the streak survived this
                    // week, so it must not read as a break.
                    <View
                      style={[
                        styles.marker,
                        styles.markerFrozen,
                        { borderColor: isDark ? primary[300] : primary[400] },
                      ]}
                    >
                      <Text style={styles.markerFrozenText}>❄️</Text>
                    </View>
                  ) : week.status === 'none' ? (
                    // No check-in / no goal that week — a real streak break.
                    <View
                      style={[styles.marker, styles.markerEmpty, { borderColor: emptyBorderColor }]}
                    />
                  ) : (
                    <View
                      style={[
                        styles.marker,
                        week.status === 'hit' ? styles.markerHit : styles.markerMiss,
                      ]}
                    >
                      <Text style={styles.markerText}>{week.status === 'hit' ? '✓' : '✗'}</Text>
                    </View>
                  )}
                  <View style={styles.markerLabel}>
                    <Text style={[styles.markerDate, { color: dateLabelColor }]} numberOfLines={1}>
                      {monthFormatter.format(date)}
                    </Text>
                    <Text style={[styles.markerDate, { color: dateLabelColor }]} numberOfLines={1}>
                      {t('weeklyCheckIn.step1.weekOfMonth', { week: weekOfMonth(date) })}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )
      )}
    </View>
  );
}

// Week-of-month for a week's Monday: Jun 1-7 → 1, Jun 8-14 → 2, …
function weekOfMonth(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[3],
    overflow: 'hidden',
    ...shadowsSemanticNative.card,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2.5],
  },
  flame: {
    fontSize: 26,
    lineHeight: 30,
  },
  heroText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacingPixels[2],
  },
  bigNumber: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    flexShrink: 1,
  },
  freshTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  freezeChip: {
    paddingVertical: 3,
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.full,
  },
  freezeChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginTop: spacingPixels[2.5],
    marginBottom: spacingPixels[2.5],
  },
  lastWeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginBottom: spacingPixels[2],
  },
  lastWeekLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  lastWeekValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  markersRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  markerCol: {
    flex: 1,
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerHit: {
    backgroundColor: primary[600],
  },
  markerMiss: {
    backgroundColor: secondary[500],
    opacity: 0.9,
  },
  markerFrozen: {
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  markerFrozenText: {
    fontSize: 12,
    lineHeight: 14,
  },
  markerEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  markerText: {
    fontSize: 12,
    fontWeight: '800',
    color: base.white,
    lineHeight: 14,
  },
  markerLabel: {
    alignItems: 'center',
  },
  markerDate: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.1,
    lineHeight: 14,
  },
  placeholder: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
  },
});
