/**
 * ProgressDots — 4-dot indicator with the active dot stretching to a pill.
 *
 * Lifts the PreOnboardingScreen progress dot pattern (lines 349-362):
 * legacy React Native Animated, 280ms cubic easing, native driver, active
 * dot expands from 8px circle to 22px pill.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useThemeStyles } from '@rallia/shared-hooks';
import { primary } from '@rallia/design-system';

const DOT_SIZE = 8;
const ACTIVE_WIDTH = 22;
const DURATION = 280;

interface ProgressDotsProps {
  current: number; // 1-based step
  total: number;
}

export function ProgressDots({ current, total }: ProgressDotsProps) {
  return (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: current, min: 1, max: total }}
    >
      {Array.from({ length: total }, (_, i) => (
        <Dot key={i} index={i + 1} current={current} />
      ))}
    </View>
  );
}

function Dot({ index, current }: { index: number; current: number }) {
  const { isDark } = useThemeStyles();
  const widthAnim = useRef(new Animated.Value(index === current ? ACTIVE_WIDTH : DOT_SIZE)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: index === current ? ACTIVE_WIDTH : DOT_SIZE,
      duration: DURATION,
      easing: Easing.out(Easing.cubic),
      // We're animating layout (width) — native driver doesn't support it.
      useNativeDriver: false,
    }).start();
  }, [index, current, widthAnim]);

  // Color: filled primary for current, light primary tint for completed,
  // lightest tint for upcoming. In dark mode we deepen the "upcoming" tint
  // so the inactive dots stay visible against the dark canvas.
  const isCompleted = index < current;
  const isActive = index === current;
  const backgroundColor = isActive
    ? primary[600]
    : isCompleted
      ? primary[400]
      : isDark
        ? primary[800]
        : primary[100];

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          width: widthAnim,
          backgroundColor,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});
