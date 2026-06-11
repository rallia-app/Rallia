/**
 * StreakCard — Step-1 recap hero: WEEKLY GOAL STREAK + goal-hit tracking.
 *
 * One warm "fireplace" card combining what used to be two:
 *   • the streak hero (🔥 N + "WEEKLY GOAL STREAK", or "Start a streak this week")
 *   • the freeze footer (returning players only)
 *   • goal tracking: last-week result + the 4-week hit/miss history strip
 *
 * The streak advances at week-end when sessions_played >= frequency_goal
 * (evaluate_weekly_goals). Only games the player checked into count as sessions,
 * so checking in at the court is what makes a game count — completing this weekly
 * wizard does not itself advance the streak. A freeze auto-rescues one miss.
 *
 * History markers are three-state so the strip always justifies the streak
 * number: ✓ hit, ❄️ missed-but-rescued (streak survived), ✗ missed (streak
 * broke). Counting non-✗ from the right = min(streak, 4).
 *
 * Deliberately compact — the goal picker below must stay on screen without
 * scrolling, so everything is single-purpose: one hero row (streak + freeze
 * chip), one last-week line, one marker strip, one short court-check-in note.
 *
 *   ┌────────────────────────────────────────────────┐
 *   │  🔥 4 WEEKLY GOAL STREAK              ❄️ ×1   │
 *   │  ────────────────────────────────────────────  │
 *   │  Last week: 2 played · goal 3  ✗               │
 *   │   ✓     ✓     ❄️    ✗                          │
 *   │  May4  May11 May18 May25                        │
 *   │  📍 Games only count with an on-court check-in.│
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

const COUNT_UP_DURATION_MS = 800;
const HISTORY_WEEKS = 4;

type WeekMark = 'hit' | 'frozen' | 'miss';

interface StreakCardProps {
  currentStreak: number;
  freezeInventory: number;
  lastWeekGoal: number | null;
  lastWeekPlayed: number | null;
  /** Newest-first array of booleans from get_check_in_context RPC. */
  goalsHitLast4Weeks: boolean[];
  /** Parallel to goalsHitLast4Weeks: TRUE where a freeze rescued that miss. */
  freezesUsedLast4Weeks: boolean[];
}

export function StreakCard({
  currentStreak,
  freezeInventory,
  lastWeekGoal,
  lastWeekPlayed,
  goalsHitLast4Weeks,
  freezesUsedLast4Weeks,
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
  const noteColor = isDark ? accent[200] : accent[800];

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
  // Fold hit + freeze-used into one mark per week, then reverse the
  // newest-first arrays to render left-to-right chronological.
  const marks: WeekMark[] = goalsHitLast4Weeks
    .slice(0, HISTORY_WEEKS)
    .map((hit, i) => (hit ? 'hit' : freezesUsedLast4Weeks[i] ? 'frozen' : 'miss'));
  const historyOldestFirst = marks.slice().reverse();
  const emptySlots = HISTORY_WEEKS - historyOldestFirst.length;
  const dateFormatter = new Intl.DateTimeFormat(locale ?? 'en-US', {
    month: 'short',
    day: 'numeric',
  });
  const thisMonday = startOfIsoWeek(new Date());
  const historyDates: Date[] = [];
  for (let i = HISTORY_WEEKS; i >= 1; i--) {
    historyDates.push(subWeeks(thisMonday, i));
  }

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
  const isFirstTimeGoals = goalsHitLast4Weeks.length === 0 && lastWeekGoal == null;

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
        goalsHitLast4Weeks.length > 0 && (
          <View style={styles.markersRow}>
            {Array.from({ length: emptySlots }, (_, i) => (
              <View key={`e-${i}`} style={styles.markerCol}>
                <View
                  style={[styles.marker, styles.markerEmpty, { borderColor: emptyBorderColor }]}
                />
                <Text style={[styles.markerDate, { color: dateLabelColor }]} numberOfLines={1}>
                  {dateFormatter.format(historyDates[i])}
                </Text>
              </View>
            ))}
            {historyOldestFirst.map((mark, i) => {
              const date = historyDates[emptySlots + i];
              return (
                <View key={`h-${i}`} style={styles.markerCol}>
                  {mark === 'frozen' ? (
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
                  ) : (
                    <View
                      style={[styles.marker, mark === 'hit' ? styles.markerHit : styles.markerMiss]}
                    >
                      <Text style={styles.markerText}>{mark === 'hit' ? '✓' : '✗'}</Text>
                    </View>
                  )}
                  <Text style={[styles.markerDate, { color: dateLabelColor }]} numberOfLines={1}>
                    {dateFormatter.format(date)}
                  </Text>
                </View>
              );
            })}
          </View>
        )
      )}

      {/* How games count — checking in at the court is what advances the streak */}
      <Text style={[styles.checkInNote, { color: noteColor }]}>
        {t('weeklyCheckIn.step1.checkInNote')}
      </Text>
    </View>
  );
}

// Date helpers
function startOfIsoWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offsetToMonday);
  date.setHours(0, 0, 0, 0);
  return date;
}
function subWeeks(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - n * 7);
  return x;
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
  markerDate: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  placeholder: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
  },
  checkInNote: {
    fontSize: 10.5,
    fontWeight: '600',
    lineHeight: 14,
    marginTop: spacingPixels[2.5],
  },
});
