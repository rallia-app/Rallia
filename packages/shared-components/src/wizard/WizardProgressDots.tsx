/**
 * Step indicator as dots, the active one stretching to a pill. The compact
 * alternative to WizardProgressBar for full-screen flows with no room for a
 * labelled bar.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useThemeStyles } from '@rallia/shared-hooks';
import { primary } from '@rallia/design-system';

const DOT_SIZE = 8;
const ACTIVE_WIDTH = 22;
const DURATION = 280;

export interface WizardProgressDotsProps {
  /** 1-based index of the current step. */
  current: number;
  total: number;
}

export function WizardProgressDots({ current, total }: WizardProgressDotsProps) {
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

  // Filled primary for current, lighter tint for completed, lightest for
  // upcoming — deepened in dark mode so inactive dots stay visible.
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
