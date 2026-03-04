/**
 * InvitePlayersWizard
 *
 * A 2-step wizard for inviting players to Rallia via referral link and contacts.
 * Slides in from the ActionsBottomSheet, same pattern as MatchCreationWizard.
 *
 * Step 1: Share Link — referral code, QR, share sheet, stats
 * Step 2: Invite Contacts — device contacts picker with SMS compose
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Keyboard,
  ScrollView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useTheme, useReferral } from '@rallia/shared-hooks';
import { useTranslation, type TranslationKey } from '../../../hooks/useTranslation';
import { useAuth } from '../../../hooks';

import { ShareLinkStep } from './steps/ShareLinkStep';
import { InviteContactsStep } from './steps/InviteContactsStep';

const BASE_WHITE = '#ffffff';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_STEPS = 2;

// ============================================================================
// TYPES
// ============================================================================

interface InvitePlayersWizardProps {
  onClose: () => void;
  onBackToLanding: () => void;
}

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  progressActive: string;
  progressInactive: string;
}

// ============================================================================
// PROGRESS BAR
// ============================================================================

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ currentStep, totalSteps, colors, t }) => {
  const progress = useSharedValue((currentStep / totalSteps) * 100);

  React.useEffect(() => {
    progress.value = withTiming((currentStep / totalSteps) * 100, { duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, totalSteps]);

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  const stepNames = [
    t('referral.stepNames.shareLink'),
    t('referral.stepNames.inviteContacts'),
  ];
  const currentStepName = stepNames[currentStep - 1] || '';

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {t('referral.step')
            .replace('{current}', String(currentStep))
            .replace('{total}', String(totalSteps))}
        </Text>
        <Text size="sm" weight="bold" color={colors.progressActive}>
          {currentStepName}
        </Text>
      </View>
      <View style={[styles.progressBarBg, { backgroundColor: colors.progressInactive }]}>
        <Animated.View
          style={[
            styles.progressBarFill,
            { backgroundColor: colors.progressActive },
            animatedProgressStyle,
          ]}
        />
      </View>
    </View>
  );
};

// ============================================================================
// WIZARD HEADER
// ============================================================================

interface WizardHeaderProps {
  currentStep: number;
  onBack: () => void;
  onBackToLanding: () => void;
  onClose: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}

const WizardHeader: React.FC<WizardHeaderProps> = ({
  currentStep,
  onBack,
  onBackToLanding,
  onClose,
  colors,
  t,
}) => {
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <View style={styles.headerLeft}>
        {currentStep === 1 ? (
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              lightHaptic();
              onBackToLanding();
            }}
            style={styles.headerButton}
            accessibilityLabel="Back to actions"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              lightHaptic();
              onBack();
            }}
            style={styles.headerButton}
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
          </TouchableOpacity>
        )}
      </View>

      {/* Title */}
      <Text size="base" weight="semibold" color={colors.text}>
        {t('referral.wizardTitle')}
      </Text>

      {/* Close button */}
      <View style={styles.headerRight}>
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            lightHaptic();
            onClose();
          }}
          style={styles.headerButton}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        >
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ============================================================================
// MAIN WIZARD COMPONENT
// ============================================================================

export const InvitePlayersWizard: React.FC<InvitePlayersWizardProps> = ({
  onClose,
  onBackToLanding,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { session } = useAuth();
  const isDark = theme === 'dark';

  const playerId = session?.user?.id;
  const {
    code,
    codeLoading,
    referralLink,
    stats,
    statsLoading,
    recordInvites,
    isRecording,
  } = useReferral(playerId);

  // State
  const [currentStep, setCurrentStep] = useState(1);
  const [highestStepVisited, setHighestStepVisited] = useState(1);

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors: ThemeColors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: BASE_WHITE,
      progressActive: isDark ? primary[500] : primary[600],
      progressInactive: themeColors.muted,
    }),
    [themeColors, isDark]
  );

  // Step animation values
  const step1X = useSharedValue(0);
  const step2X = useSharedValue(SCREEN_WIDTH);

  const animateToStep = useCallback(
    (step: number) => {
      const springConfig = { damping: 80, stiffness: 600, overshootClamping: false };
      if (step === 1) {
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
        step1X.value = withSpring(0, springConfig);
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
        step2X.value = withSpring(SCREEN_WIDTH, springConfig);
      } else {
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
        step1X.value = withSpring(-SCREEN_WIDTH, springConfig);
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
        step2X.value = withSpring(0, springConfig);
      }
    },
    [step1X, step2X]
  );

  const handleNext = useCallback(() => {
    if (currentStep < TOTAL_STEPS) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      setHighestStepVisited(prev => Math.max(prev, nextStep));
      animateToStep(nextStep);
    }
  }, [currentStep, animateToStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      animateToStep(prevStep);
    }
  }, [currentStep, animateToStep]);

  // Animated styles
  const step1Style = useAnimatedStyle(() => ({
    transform: [{ translateX: step1X.value }],
  }));

  const step2Style = useAnimatedStyle(() => ({
    transform: [{ translateX: step2X.value }],
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      <WizardHeader
        currentStep={currentStep}
        onBack={handleBack}
        onBackToLanding={onBackToLanding}
        onClose={onClose}
        colors={colors}
        t={t}
      />

      <ProgressBar
        currentStep={currentStep}
        totalSteps={TOTAL_STEPS}
        colors={colors}
        t={t}
      />

      {/* Steps container */}
      <View style={styles.stepsContainer}>
        {/* Step 1: Share Link */}
        <Animated.View style={[styles.stepPanel, step1Style]}>
          <ScrollView
            style={styles.stepScroll}
            contentContainerStyle={styles.stepScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <ShareLinkStep
              code={code}
              codeLoading={codeLoading}
              referralLink={referralLink}
              stats={stats}
              statsLoading={statsLoading}
              colors={colors}
              isDark={isDark}
              t={t}
            />
          </ScrollView>
        </Animated.View>

        {/* Step 2: Invite Contacts (lazy mounted) */}
        {highestStepVisited >= 2 && (
          <Animated.View style={[styles.stepPanel, styles.stepPanelAbsolute, step2Style]}>
            <InviteContactsStep
              referralLink={referralLink}
              playerId={playerId ?? ''}
              onRecordInvites={recordInvites}
              isRecording={isRecording}
              colors={colors}
              isDark={isDark}
              t={t}
            />
          </Animated.View>
        )}
      </View>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {currentStep === 1 ? (
          <TouchableOpacity
            style={[styles.footerButton, { backgroundColor: colors.buttonActive }]}
            onPress={handleNext}
          >
            <Text size="base" weight="semibold" color={BASE_WHITE}>
              {t('common.next')}
            </Text>
            <Ionicons name="chevron-forward-outline" size={20} color={BASE_WHITE} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.footerButton, { backgroundColor: colors.buttonActive }]}
            onPress={onClose}
          >
            <Text size="base" weight="semibold" color={BASE_WHITE}>
              {t('common.done')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
    alignItems: 'flex-start',
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  progressContainer: {
    paddingHorizontal: spacingPixels[6],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[2],
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  progressBarBg: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  stepsContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  stepPanel: {
    width: '100%',
    flex: 1,
  },
  stepPanelAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  stepScroll: {
    flex: 1,
  },
  stepScrollContent: {
    flexGrow: 1,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[1],
  },
});
