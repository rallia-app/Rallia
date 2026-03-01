/**
 * ReportSubmittedSuccessModal Component
 *
 * A celebratory modal shown after successfully submitting a user report.
 * Features animated icons, encouraging messaging, and sports-themed visuals.
 */

import React, { useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  neutral,
  primary,
} from '@rallia/design-system';
import { successHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';
import { useTranslation } from 'react-i18next';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BASE_WHITE = '#ffffff';

// =============================================================================
// TYPES
// =============================================================================

export interface ReportSubmittedSuccessModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Callback when the modal is dismissed */
  onClose: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ReportSubmittedSuccessModal({
  visible,
  onClose,
}: ReportSubmittedSuccessModalProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  // Theme-aware colors
  const colors = {
    backdrop: 'rgba(0, 0, 0, 0.6)',
    background: themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    textSecondary: isDark ? neutral[400] : neutral[500],
    border: themeColors.border,
    primary: themeColors.primary,
    primaryLight: isDark ? primary[900] : primary[50],
    success: '#22c55e',
    successLight: isDark ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.1)',
    infoBox: isDark ? neutral[800] : neutral[100],
  };

  // Animation values
  const iconScale = useSharedValue(0);
  const iconRotate = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(30);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(0.9);
  const checkScale = useSharedValue(0);
  const pulseScale = useSharedValue(1);

  // Trigger animations when modal becomes visible
  useEffect(() => {
    if (visible) {
      // Trigger haptic feedback
      successHaptic();

      // Reset values
      iconScale.value = 0;
      iconRotate.value = 0;
      contentOpacity.value = 0;
      contentTranslateY.value = 30;
      buttonOpacity.value = 0;
      buttonScale.value = 0.9;
      checkScale.value = 0;
      pulseScale.value = 1;

      // Icon animation - pop in with a slight rotation
      iconScale.value = withDelay(200, withSpring(1, { damping: 12, stiffness: 200 }));
      iconRotate.value = withDelay(
        200,
        withSequence(
          withTiming(-8, { duration: 100, easing: Easing.ease }),
          withTiming(8, { duration: 100, easing: Easing.ease }),
          withTiming(0, { duration: 100, easing: Easing.ease })
        )
      );

      // Checkmark pop
      checkScale.value = withDelay(400, withSpring(1, { damping: 10, stiffness: 300 }));

      // Pulse animation for icon glow
      pulseScale.value = withDelay(
        500,
        withSequence(
          withTiming(1.1, { duration: 300, easing: Easing.ease }),
          withTiming(1, { duration: 300, easing: Easing.ease })
        )
      );

      // Content animation - fade and slide up
      contentOpacity.value = withDelay(500, withTiming(1, { duration: 400 }));
      contentTranslateY.value = withDelay(500, withSpring(0, { damping: 20, stiffness: 200 }));

      // Button animation
      buttonOpacity.value = withDelay(700, withTiming(1, { duration: 300 }));
      buttonScale.value = withDelay(700, withSpring(1, { damping: 15, stiffness: 200 }));
    }
  }, [
    visible,
    iconScale,
    iconRotate,
    contentOpacity,
    contentTranslateY,
    buttonOpacity,
    buttonScale,
    checkScale,
    pulseScale,
  ]);

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }, { rotate: `${iconRotate.value}deg` }],
  }));

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const checkAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <TouchableWithoutFeedback>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            {/* Success Icon with Shield and Checkmark */}
            <Animated.View style={[styles.iconWrapper, iconAnimatedStyle]}>
              <Animated.View
                style={[styles.pulseRing, pulseAnimatedStyle, { borderColor: colors.success }]}
              />
              <View style={[styles.iconContainer, { backgroundColor: colors.successLight }]}>
                <Ionicons name="shield-checkmark" size={48} color={colors.success} />
                <Animated.View style={[styles.checkBadge, checkAnimatedStyle]}>
                  <View style={[styles.checkBadgeInner, { backgroundColor: primary[500] }]}>
                    <Ionicons name="checkmark" size={16} color={BASE_WHITE} />
                  </View>
                </Animated.View>
              </View>
            </Animated.View>

            {/* Content */}
            <Animated.View style={[styles.content, contentAnimatedStyle]}>
              {/* Title */}
              <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
                {t('chat.report.submitted')}
              </Text>

              {/* Message */}
              <Text size="sm" color={colors.textMuted} style={styles.message}>
                {t('chat.report.thankYou')}
              </Text>

              {/* Sports-themed encouragement */}
              <View style={[styles.infoBox, { backgroundColor: colors.infoBox }]}>
                <View style={styles.infoIconContainer}>
                  <Ionicons name="people" size={20} color={colors.primary} />
                </View>
                <Text size="xs" color={colors.textSecondary} style={styles.infoText}>
                  {t('chat.report.communityThanks')}
                </Text>
              </View>
            </Animated.View>

            {/* Done Button */}
            <Animated.View style={[styles.buttonContainer, buttonAnimatedStyle]}>
              <TouchableOpacity
                style={[styles.doneButton, { backgroundColor: colors.primary }]}
                onPress={handleClose}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color={BASE_WHITE}
                  style={{ marginRight: 8 }}
                />
                <Text size="base" weight="semibold" color={BASE_WHITE}>
                  {t('common.continue')}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </TouchableWithoutFeedback>
      </View>
    </Modal>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[4],
  },
  modal: {
    width: Math.min(SCREEN_WIDTH - spacingPixels[8], 340),
    borderRadius: radiusPixels['2xl'],
    padding: spacingPixels[6],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 20,
  },
  iconWrapper: {
    marginBottom: spacingPixels[4],
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    top: -5,
    left: -5,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  checkBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
  checkBadgeInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  content: {
    alignItems: 'center',
    marginBottom: spacingPixels[5],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  message: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    width: '100%',
  },
  infoIconContainer: {
    marginRight: spacingPixels[3],
  },
  infoText: {
    flex: 1,
    lineHeight: 18,
  },
  buttonContainer: {
    width: '100%',
  },
  doneButton: {
    height: 52,
    borderRadius: radiusPixels.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});

export default ReportSubmittedSuccessModal;
