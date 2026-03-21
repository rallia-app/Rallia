/**
 * Feedback FAB (Floating Action Button)
 *
 * A floating action button for quick access to the feedback report sheet.
 * Designed to be placed inside screen-level FAB containers.
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
import { secondary } from '@rallia/design-system';

import { useFeedbackReportSheet } from '../context/BugReportSheetContext';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export const FeedbackFAB: React.FC = () => {
  const { openFeedbackReport } = useFeedbackReportSheet();

  // Animation values
  const scale = useSharedValue(1);

  // Handle press with animation
  const handlePress = useCallback(() => {
    void lightHaptic();

    // Animate press
    scale.value = withSequence(withSpring(0.9, { damping: 10 }), withSpring(1, { damping: 10 }));

    // Open feedback report sheet
    openFeedbackReport('fab');
  }, [openFeedbackReport, scale]);

  // Animated style for press feedback
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedTouchable
      style={[
        styles.fab,
        {
          backgroundColor: secondary[500],
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
      accessibilityLabel="Send feedback"
      accessibilityRole="button"
      accessibilityHint="Opens the feedback form"
    >
      <Ionicons name="chatbox-ellipses-outline" size={24} color="#FFFFFF" />
    </AnimatedTouchable>
  );
};

const styles = StyleSheet.create({
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default FeedbackFAB;
