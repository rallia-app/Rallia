/**
 * Bug Report FAB (Floating Action Button)
 *
 * A centralized floating action button that appears on all screens
 * to provide quick access to the bug report sheet.
 */

import React, { useCallback } from 'react';
import { TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
} from 'react-native-reanimated';
import { lightHaptic } from '@rallia/shared-utils';
import { status } from '@rallia/design-system';

import { useBugReportSheet } from '../context/BugReportSheetContext';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export const BugReportFAB: React.FC = () => {
  const { openBugReport, isOpen } = useBugReportSheet();

  // Animation values
  const scale = useSharedValue(1);

  // Handle press with animation
  const handlePress = useCallback(() => {
    void lightHaptic();

    // Animate press
    scale.value = withSequence(withSpring(0.9, { damping: 10 }), withSpring(1, { damping: 10 }));

    // Open bug report sheet
    openBugReport('fab');
  }, [openBugReport, scale]);

  // Animated style for press feedback
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Don't show FAB when bug report sheet is open
  if (isOpen) {
    return null;
  }

  return (
    <AnimatedTouchable
      style={[
        styles.fab,
        {
          backgroundColor: status.error.DEFAULT,
          // Platform-specific shadow
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
            },
            android: {
              elevation: 8,
            },
          }),
        },
        animatedStyle,
      ]}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityLabel="Report a bug"
      accessibilityRole="button"
      accessibilityHint="Opens the bug report form"
    >
      <Ionicons name="bug-outline" size={24} color="#FFFFFF" />
    </AnimatedTouchable>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 100, // Above tab bar
    left: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9998, // Below bug report sheet but above other content
  },
});

export default BugReportFAB;
