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
import { useTranslation } from '../hooks';
import { useThemeStyles } from '@rallia/shared-hooks';
import { useTour } from '../context/TourContext';
import { tourService } from '@rallia/shared-services';
import { Logger } from '@rallia/shared-services';
import { Ionicons } from '@expo/vector-icons';
import { lightHaptic, mediumHaptic } from '../utils/haptics';

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
  const { startTour, isTourCompleted, isLoading } = useTour();
  const insets = useSafeAreaInsets();
  const tintedPrimaryBg = `${colors.primary}26`; // ~15% alpha tint for icon rings

  const FeatureItem: React.FC<FeatureItemProps> = ({ icon, text }) => (
    <View style={styles.featureItem}>
      <View style={[styles.featureIconContainer, { backgroundColor: tintedPrimaryBg }]}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={[styles.featureText, { color: colors.text }]}>{text}</Text>
    </View>
  );

  const [visible, setVisible] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));

  // Check if we should show the modal
  useEffect(() => {
    const checkShowModal = async () => {
      // Wait for tour loading to complete and prerequisites
      if (isLoading || !splashComplete || !permissionsHandled) {
        return;
      }

      try {
        // Check if welcome tour is completed
        const welcomeCompleted = isTourCompleted('welcome');
        const mainNavCompleted = isTourCompleted('main_navigation');

        if (!welcomeCompleted && !mainNavCompleted) {
          // New user or never took the tour
          const isFirstTime = await tourService.isFirstTimeUser();
          setIsReturningUser(!isFirstTime);
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
  }, [isLoading, splashComplete, permissionsHandled, isTourCompleted, fadeAnim, slideAnim]);

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
      await tourService.setTourCompleted('welcome', true);
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
          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: tintedPrimaryBg }]}>
            <Ionicons name="map-outline" size={48} color={colors.primary} />
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            {isReturningUser ? t('tour.welcome.returnUser.title') : t('tour.welcome.title')}
          </Text>

          {/* Subtitle */}
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {isReturningUser ? t('tour.welcome.returnUser.subtitle') : t('tour.welcome.subtitle')}
          </Text>

          {/* Feature highlights */}
          <View style={styles.featuresContainer}>
            <FeatureItem
              icon="game-controller-outline"
              text={t('tour.mainNavigation.matches.title')}
            />
            <FeatureItem icon="chatbubbles-outline" text={t('tour.mainNavigation.chat.title')} />
            <FeatureItem icon="person-outline" text={t('tour.mainNavigation.profile.title')} />
          </View>

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
              <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
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

// Feature item component (rendered inside WelcomeTourModal so it shares the themed colors closure)
interface FeatureItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}

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
  featuresContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 32,
    gap: 24,
  },
  featureItem: {
    alignItems: 'center',
    gap: 8,
  },
  featureIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
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
