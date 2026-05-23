/**
 * StreakCard — Step 1 hero card.
 *
 * Visual concept: a "fireplace card." A diagonal warm gradient (amber →
 * peach in light, deep mahogany in dark) carries the brand celebration
 * vibe. A soft glowing halo sits behind the flame, which pulses on a slow
 * loop. The streak number animates with a count-up on mount. Active weeks
 * become mini flame icons trailing behind the big flame, fading in from
 * oldest to most recent.
 *
 * Three independent signals still surface — count + freeze inventory +
 * goal-hit history — exactly as in the original spec; the upgrade is
 * purely visual / motion.
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
import { useTranslation } from '../../../hooks';

const STREAK_DOTS_TOTAL = 8;
const GOALS_HISTORY_LEN = 4;
const COUNT_UP_DURATION_MS = 800;
const FLAME_PULSE_DURATION_MS = 1400;

interface StreakCardProps {
  currentStreak: number;
  freezeInventory: number;
  goalsHitLast4Weeks: boolean[];
}

export function StreakCard({
  currentStreak,
  freezeInventory,
  goalsHitLast4Weeks,
}: StreakCardProps) {
  const { t } = useTranslation();
  const { isDark } = useThemeStyles();
  const isFresh = currentStreak === 0;

  // Theme-aware palette. The card keeps its warm "fireplace" identity in
  // both modes — dark mode shifts to deep accent/secondary 900s so the
  // gradient still feels lit-up, not muddy.
  const gradientStops = isDark
    ? ([accent[900], `${secondary[700]}AA`] as const)
    : ([accent[200], `${secondary[300]}BB`] as const);
  const surfaceBorder = isDark ? accent[700] : accent[400];
  const numberColor = isDark ? accent[100] : accent[800];
  const subtitleColor = isDark ? accent[300] : accent[700];
  const dividerColor = `${isDark ? accent[400] : accent[700]}40`; // ~25% opacity
  // Label sits on the warm gradient — use accent tints (not neutrals) so it
  // reads as part of the card vocabulary in both modes.
  const labelColor = isDark ? accent[300] : accent[800];
  const haloColor = isDark ? accent[400] : accent[300];
  // Freeze pill — warm-tinted to match the fireplace card (the old blue was
  // off-brand and washed out on the dark mahogany gradient).
  const freezePillBg = isDark ? `${accent[100]}26` : `${base.white}99`; // dark: 15% accent-100, light: 60% white
  const freezePillBorder = isDark ? `${accent[200]}66` : `${accent[600]}33`;
  const freezeTextColor = isDark ? accent[100] : accent[800];
  // Dashed border for upcoming-week markers — needs to be visible on both
  // the dark mahogany and the light amber gradient.
  const emptyMarkerBorder = isDark ? `${accent[200]}80` : `${accent[700]}55`;

  // Count-up animation: animate the underlying Animated.Value from 0 →
  // currentStreak on mount, then `useNativeDriver: false` so we can read
  // it on the JS thread for the displayed text. Cheap because it only
  // updates a tiny string.
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

  // Flame pulse: subtle scale + opacity loop on the flame + halo so the
  // card feels "lit". useNativeDriver since it's just transform + opacity.
  // IMPORTANT: stop the loop on unmount — leaving an Animated.loop running
  // after the screen unmounts keeps frame callbacks alive, which can race
  // with the native fullScreenModal dismissal and leave the app's touch
  // layer stuck.
  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: FLAME_PULSE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: FLAME_PULSE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const flameScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const haloScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.15],
  });
  const haloOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.65],
  });

  // Pad history to fixed length with "empty" markers for missing weeks.
  const history = goalsHitLast4Weeks.slice(-GOALS_HISTORY_LEN);
  const emptySlots = GOALS_HISTORY_LEN - history.length;

  // First-time user (no prior weeks at all) → drop the "Goals hit" row.
  const showGoalsHistory = history.length > 0;

  return (
    <View style={[styles.card, { borderColor: surfaceBorder }]}>
      <LinearGradient
        colors={gradientStops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Top row: big flame + count + freeze pill */}
      <View style={styles.topRow}>
        <View style={styles.flameWrap}>
          <Animated.View
            style={[
              styles.halo,
              {
                backgroundColor: haloColor,
                opacity: haloOpacity,
                transform: [{ scale: haloScale }],
              },
            ]}
          />
          <Animated.Text style={[styles.flame, { transform: [{ scale: flameScale }] }]}>
            🔥
          </Animated.Text>
        </View>

        <View style={styles.body}>
          {isFresh ? (
            <Text style={[styles.freshTitle, { color: numberColor }]}>
              {t('weeklyCheckIn.step1.streakTitleZero')}
            </Text>
          ) : (
            <View style={styles.numberRow}>
              <Text style={[styles.bigNumber, { color: numberColor }]}>{displayCount}</Text>
              <Text style={[styles.bigNumberSuffix, { color: subtitleColor }]}>
                {displayCount === 1
                  ? t('weeklyCheckIn.step1.streakSubtitleOne')
                  : t('weeklyCheckIn.step1.streakSubtitle')}
              </Text>
            </View>
          )}

          {/* Mini-flame trail for active weeks + dim dots for upcoming */}
          <View style={styles.dotsRow}>
            {Array.from({ length: STREAK_DOTS_TOTAL }, (_, i) => {
              const active = i < currentStreak;
              return active ? (
                <Text key={i} style={styles.miniFlame}>
                  🔥
                </Text>
              ) : (
                <View
                  key={i}
                  style={[
                    styles.dimDot,
                    {
                      // Slightly punchier than before so the upcoming-week
                      // dots remain visible against the warm gradient.
                      backgroundColor: isDark ? `${accent[200]}40` : `${accent[800]}26`,
                      borderColor: isDark ? `${accent[200]}66` : `${accent[800]}40`,
                    },
                  ]}
                />
              );
            })}
          </View>
        </View>

        {/* Freeze pill */}
        <View
          style={[
            styles.freezePill,
            { backgroundColor: freezePillBg, borderColor: freezePillBorder },
            freezeInventory === 0 && styles.freezePillDepleted,
          ]}
        >
          <Text style={styles.freezeIcon}>❄️</Text>
          <Text style={[styles.freezeCount, { color: freezeTextColor }]}>×{freezeInventory}</Text>
        </View>
      </View>

      {showGoalsHistory && (
        <>
          <View style={[styles.divider, { backgroundColor: dividerColor }]} />
          <View style={styles.goalsRow}>
            <Text style={[styles.goalsLabel, { color: labelColor }]}>
              {t('weeklyCheckIn.step1.goalsHitLabel')}
            </Text>
            <View style={styles.goalsMarkers}>
              {Array.from({ length: emptySlots }, (_, i) => (
                <View
                  key={`e-${i}`}
                  style={[
                    styles.goalMarker,
                    styles.goalMarkerEmpty,
                    { borderColor: emptyMarkerBorder },
                  ]}
                />
              ))}
              {history.map((hit, i) => (
                <View
                  key={`h-${i}`}
                  style={[styles.goalMarker, hit ? styles.goalMarkerHit : styles.goalMarkerMiss]}
                >
                  <Text style={styles.goalMarkerText}>{hit ? '✓' : '✗'}</Text>
                </View>
              ))}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const HALO_SIZE = 56;

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[3],
    overflow: 'hidden', // clip the gradient + halo to the rounded corners
    ...shadowsSemanticNative.card,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  flameWrap: {
    width: HALO_SIZE,
    height: HALO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: HALO_SIZE,
    height: HALO_SIZE,
    borderRadius: HALO_SIZE / 2,
  },
  flame: {
    fontSize: 38,
    lineHeight: 42,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  freshTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacingPixels[2],
  },
  bigNumber: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1.2,
    lineHeight: 38,
    fontVariant: ['tabular-nums'],
  },
  bigNumberSuffix: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 6,
    alignItems: 'center',
  },
  miniFlame: {
    fontSize: 13,
    lineHeight: 16,
  },
  dimDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    marginHorizontal: 2,
  },
  freezePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 4,
    borderRadius: radiusPixels.full,
    alignSelf: 'flex-start',
  },
  freezePillDepleted: {
    opacity: 0.45,
  },
  freezeIcon: {
    fontSize: 12,
    lineHeight: 14,
  },
  freezeCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginVertical: spacingPixels[3],
  },
  goalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  goalsLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  goalsMarkers: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  goalMarker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalMarkerHit: {
    backgroundColor: primary[600],
  },
  goalMarkerMiss: {
    backgroundColor: secondary[500],
    opacity: 0.85,
  },
  goalMarkerEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  goalMarkerText: {
    fontSize: 11,
    fontWeight: '800',
    color: base.white,
    lineHeight: 13,
  },
});
