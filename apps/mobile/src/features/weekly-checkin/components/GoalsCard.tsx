/**
 * GoalsCard — Step 1 secondary card for the GOAL-HIT history.
 *
 * Single-signal card: tells the player "did you actually play enough to hit
 * your weekly goal?". Intentionally separated from StreakCard so the two
 * distinct metrics — discipline (streak) vs performance (goals) — read as
 * the independent signals they are.
 *
 *   ┌────────────────────────────────────────────────┐
 *   │  GOAL TRACKING               Last week  2/3 ✗  │
 *   │   ✓     ✓     ✗     ✗                          │
 *   │  Apr20 Apr27 May4 May11                         │
 *   └────────────────────────────────────────────────┘
 *
 * Compact layout: the last-week result rides on the title row (played/goal +
 * a hit/miss glyph), and the 4-week trend sits directly below — no divider or
 * stacked section labels.
 *
 * For first-time users with no prior history, renders a friendly placeholder
 * line so the card doesn't look broken.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import {
  base,
  primary,
  secondary,
  radiusPixels,
  shadowsSemanticNative,
  spacingPixels,
} from '@rallia/design-system';

import { useTranslation } from '#/hooks';
import { useLocale } from '#/context';

const HISTORY_WEEKS = 4;

interface GoalsCardProps {
  lastWeekGoal: number | null;
  lastWeekPlayed: number | null;
  /** Newest-first array of booleans from get_check_in_context RPC. */
  goalsHitLast4Weeks: boolean[];
}

export function GoalsCard({ lastWeekGoal, lastWeekPlayed, goalsHitLast4Weeks }: GoalsCardProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { colors, isDark } = useThemeStyles();

  const titleColor = colors.textMuted;
  const subTextColor = colors.textMuted;
  const dateLabelColor = colors.textMuted;
  const emptyBorderColor = isDark ? `${colors.border}` : colors.border;

  // Reverse the newest-first array to render left-to-right chronological.
  const historyOldestFirst = goalsHitLast4Weeks.slice(0, HISTORY_WEEKS).slice().reverse();
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

  // First-time user: no prior history at all
  const isFirstTime = goalsHitLast4Weeks.length === 0 && lastWeekGoal == null;

  // Last-week summary derivation
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

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: titleColor }]}>
          {t('weeklyCheckIn.step1.goalsCardTitle')}
        </Text>

        {!isFirstTime && hasLastWeek && (
          <View style={styles.lastWeekInline}>
            <Text style={[styles.lastWeekInlineLabel, { color: subTextColor }]}>
              {t('weeklyCheckIn.step1.goalsCardLastWeek')}
            </Text>
            <Text style={[styles.lastWeekInlineValue, { color: lastWeekStatusColor }]}>
              {playedCount}/{lastWeekGoal} {lastWeekHit ? '✓' : '✗'}
            </Text>
          </View>
        )}
      </View>

      {isFirstTime ? (
        <Text style={[styles.placeholder, { color: subTextColor }]}>
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
            {historyOldestFirst.map((hit, i) => {
              const date = historyDates[emptySlots + i];
              return (
                <View key={`h-${i}`} style={styles.markerCol}>
                  <View style={[styles.marker, hit ? styles.markerHit : styles.markerMiss]}>
                    <Text style={styles.markerText}>{hit ? '✓' : '✗'}</Text>
                  </View>
                  <Text style={[styles.markerDate, { color: dateLabelColor }]} numberOfLines={1}>
                    {dateFormatter.format(date)}
                  </Text>
                </View>
              );
            })}
          </View>
        )
      )}
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
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[3],
    ...shadowsSemanticNative.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  lastWeekInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  lastWeekInlineLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  lastWeekInlineValue: {
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
    width: 28,
    height: 28,
    borderRadius: 14,
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
  markerEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  markerText: {
    fontSize: 14,
    fontWeight: '800',
    color: base.white,
    lineHeight: 16,
  },
  markerDate: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  placeholder: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
});
