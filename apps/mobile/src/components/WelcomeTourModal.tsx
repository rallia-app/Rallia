/**
 * WelcomeTourModal - Initial modal shown to new/returning users
 *
 * This modal appears when:
 * 1. A new user opens the app for the first time
 * 2. A returning user hasn't completed the main tour
 *
 * It offers the option to start the guided tour or skip it.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStyles } from '@rallia/shared-hooks';
import { Logger } from '@rallia/shared-services';
import { Ionicons } from '@expo/vector-icons';

import { useTour } from '#/context/TourContext';
import { useTranslation } from '#/hooks';
import { lightHaptic, mediumHaptic } from '#/utils/haptics';
import { WELCOME_TOUR_ENABLED } from '#/hooks/useTourSequence';

interface WelcomeTourModalProps {
  /** Whether the splash animation is complete */
  splashComplete?: boolean;
  /** Whether permissions have been handled */
  permissionsHandled?: boolean;
}

export const WelcomeTourModal: React.FC<WelcomeTourModalProps> = ({
  splashComplete = true,
  permissionsHandled = true,
}) => {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();
  const { startTour, completeTour, isLoading, tourStatus } = useTour();
  const insets = useSafeAreaInsets();
  const tintedPrimaryBg = `${colors.primary}26`; // ~15% alpha tint for icon rings

  const [visible, setVisible] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));

  // Check if we should show the modal
  useEffect(() => {
    const checkShowModal = () => {
      if (!WELCOME_TOUR_ENABLED) return;
      // Wait for tour loading to complete and prerequisites
      if (isLoading || !splashComplete || !permissionsHandled) {
        return;
      }

      try {
        // Read completion straight from the reactive tourStatus snapshot, NOT the
        // ref-backed isTourCompleted: a dismissal's own setTourStatus re-triggers this
        // effect, but the context's ref sync is a parent effect that runs AFTER this
        // child effect — so isTourCompleted would still report stale "false" and the
        // modal would pop back up (in the "Welcome back" state, since storage is fresh).
        const welcomeCompleted = tourStatus.welcome === true;
        const mainNavCompleted = tourStatus.main_navigation === true;

        if (!welcomeCompleted && !mainNavCompleted) {
          // Returning = any tour completed before. Derive it from the same tourStatus
          // snapshot so the show-guard and the welcome/welcome-back variant can never
          // disagree (the old async isFirstTimeUser() read a different source).
          const isReturning = Object.values(tourStatus).some(completed => completed === true);
          setIsReturningUser(isReturning);
          setVisible(true);

          // Animate in
          Animated.parallel([
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(slideAnim, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start();
        }
      } catch (error) {
        Logger.error('Failed to check tour status', error as Error);
      }
    };

    checkShowModal();
  }, [isLoading, splashComplete, permissionsHandled, tourStatus, fadeAnim, slideAnim]);

  const handleStartTour = () => {
    mediumHaptic();
    Logger.logUserAction('welcome_modal_start_tour', { isReturningUser });
    animateOut(() => {
      setVisible(false);
      // Start the main navigation tour
      startTour('main_navigation');
    });
  };

  const handleSkipTour = async () => {
    lightHaptic();
    Logger.logUserAction('welcome_modal_skip_tour', { isReturningUser });
    animateOut(async () => {
      setVisible(false);
      // Mark welcome as completed so we don't show again
      await completeTour('welcome');
    });
  };

  const animateOut = (callback: () => void) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 50,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(callback);
  };

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleSkipTour}
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Animated.View
          style={[
            styles.container,
            {
              backgroundColor: colors.cardBackground,
              transform: [{ translateY: slideAnim }],
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          {/* Hero icon */}
          <View style={[styles.iconContainer, { backgroundColor: tintedPrimaryBg }]}>
            <Ionicons name="map-outline" size={48} color={colors.primary} />
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            {isReturningUser ? t('tour.welcome.returnUser.title') : t('tour.welcome.title')}
          </Text>

          {/* Subtitle */}
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {isReturningUser ? t('tour.welcome.returnUser.subtitle') : t('tour.welcome.subtitle')}
          </Text>

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={handleStartTour}
              accessibilityLabel={
                isReturningUser
                  ? t('tour.welcome.returnUser.takeTour')
                  : t('tour.welcome.startTour')
              }
              accessibilityRole="button"
            >
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                {isReturningUser
                  ? t('tour.welcome.returnUser.takeTour')
                  : t('tour.welcome.startTour')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleSkipTour}
              accessibilityLabel={
                isReturningUser ? t('tour.welcome.returnUser.noThanks') : t('tour.welcome.skipTour')
              }
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryButtonText, { color: colors.textMuted }]}>
                {isReturningUser
                  ? t('tour.welcome.returnUser.noThanks')
                  : t('tour.welcome.skipTour')}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
});

export default WelcomeTourModal;
