/**
 * AuthWizard Component
 *
 * 2-step authentication wizard with horizontal slide animations
 * and full theme/i18n support.
 *
 * Step 1: Email entry with social sign-in buttons
 * Step 2: OTP verification
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions, Keyboard } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';

import { useAuthWizard } from '../hooks/useAuthWizard';
import { useSocialAuth } from '../hooks/useSocialAuth';
import { EmailStep } from './steps/EmailStep';
import { OTPVerificationStep } from './steps/OTPVerificationStep';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = 50;
const TOTAL_STEPS = 2;

// =============================================================================
// TYPES
// =============================================================================

export interface AuthWizardColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  inputBackground: string;
  inputBorder: string;
  inputBorderFocused: string;
  error: string;
  success: string;
  divider: string;
}

interface AuthWizardProps {
  /** Callback when authentication is successful */
  onSuccess: (needsOnboarding: boolean) => void;
  /** Callback to close the entire sheet */
  onClose: () => void;
  /** Callback to go back to the actions landing */
  onBackToLanding: () => void;
  /** Theme colors */
  colors: AuthWizardColors;
  /** Translation function */
  t: (key: TranslationKey) => string;
  /** Whether dark mode is enabled */
  isDark: boolean;
}

// =============================================================================
// =============================================================================
// WIZARD HEADER COMPONENT
// =============================================================================

interface WizardHeaderProps {
  currentStep: number;
  onBack: () => void;
  onBackToLanding: () => void;
  onClose: () => void;
  colors: AuthWizardColors;
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
        {currentStep > 1 && (
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

      <Text size="lg" weight="bold" color={colors.text}>
        {t('auth.signIn')}
      </Text>

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

// =============================================================================
// MAIN WIZARD COMPONENT
// =============================================================================

export const AuthWizard: React.FC<AuthWizardProps> = ({
  onSuccess,
  onClose,
  onBackToLanding,
  colors,
  t,
  isDark,
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const toast = useToast();

  const {
    email,
    setEmail,
    code,
    setCode,
    isLoading,
    errorMessage,
    resendCooldown,
    canResend,
    handleEmailSubmit,
    handleResendCode,
    handleVerifyCode,
    resetState,
    isEmailValid,
  } = useAuthWizard({
    // Use toast for all messages instead of Alert modals
    onVerificationError: message => toast.error(message),
    onError: message => toast.error(message),
    onSuccess: message => toast.success(message),
    onWarning: message => toast.warning(message),
  });

  // Social auth hook
  const {
    isLoading: socialAuthLoading,
    loadingProvider: socialAuthLoadingProvider,
    errorMessage: socialAuthError,
    signInWithGoogle,
    signInWithApple,
    signInWithFacebook,
    isAppleSignInAvailable,
  } = useSocialAuth();

  // Animation values
  const translateX = useSharedValue(0);
  const gestureTranslateX = useSharedValue(0);

  // Animate step changes
  useEffect(() => {
    translateX.value = withSpring(-((currentStep - 1) * SCREEN_WIDTH), {
      damping: 80,
      stiffness: 600,
      overshootClamping: false,
    });
  }, [currentStep, translateX]);

  // Handle social sign-in result: show toast when social auth sets an error.
  // Only depend on socialAuthError so we don't re-run when toast identity changes
  // (ToastProvider creates a new context value each render, which would cause an infinite loop).
  const toastErrorRef = React.useRef(toast.error);
  toastErrorRef.current = toast.error;
  useEffect(() => {
    if (socialAuthError) {
      toastErrorRef.current(socialAuthError);
    }
  }, [socialAuthError]);

  const handleSocialAuthResult = useCallback(
    async (signInFn: () => Promise<{ success: boolean; needsOnboarding: boolean }>) => {
      Keyboard.dismiss();
      const result = await signInFn();
      if (result.success) {
        onSuccess(result.needsOnboarding);
      }
    },
    [onSuccess]
  );

  // Social sign-in handlers
  const handleGoogleSignIn = useCallback(() => {
    handleSocialAuthResult(signInWithGoogle);
  }, [handleSocialAuthResult, signInWithGoogle]);

  const handleAppleSignIn = useCallback(() => {
    handleSocialAuthResult(signInWithApple);
  }, [handleSocialAuthResult, signInWithApple]);

  const handleFacebookSignIn = useCallback(() => {
    handleSocialAuthResult(signInWithFacebook);
  }, [handleSocialAuthResult, signInWithFacebook]);

  // Navigate to next step
  const goToNextStep = useCallback(async () => {
    Keyboard.dismiss();
    if (currentStep === 1) {
      const success = await handleEmailSubmit();
      if (success) {
        lightHaptic();
        setCurrentStep(2);
      }
    } else if (currentStep === 2) {
      const result = await handleVerifyCode();
      if (result.success) {
        onSuccess(result.needsOnboarding);
      }
    }
  }, [currentStep, handleEmailSubmit, handleVerifyCode, onSuccess]);

  // Navigate to previous step
  const goToPrevStep = useCallback(() => {
    Keyboard.dismiss();
    lightHaptic();
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  // Handle back to landing
  const handleBackToLanding = useCallback(() => {
    Keyboard.dismiss();
    resetState();
    setCurrentStep(1);
    onBackToLanding();
  }, [resetState, onBackToLanding]);

  // Swipe gesture handler - only allow swiping back
  const panGesture = Gesture.Pan()
    .onUpdate(e => {
      // Only allow swiping right (to go back)
      if (e.translationX > 0 && currentStep > 1) {
        gestureTranslateX.value = e.translationX;
      }
    })
    .onEnd(e => {
      if (e.translationX > SWIPE_THRESHOLD && currentStep > 1) {
        goToPrevStep();
      }
      gestureTranslateX.value = withTiming(0);
    });

  // Animated styles for step container
  const animatedStepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value + gestureTranslateX.value }],
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      {/* Header */}
      <WizardHeader
        currentStep={currentStep}
        onBack={goToPrevStep}
        onBackToLanding={handleBackToLanding}
        onClose={onClose}
        colors={colors}
        t={t}
      />

      {/* Step content with swipe */}
      <View style={styles.stepsViewport}>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              styles.stepsContainer,
              { width: SCREEN_WIDTH * TOTAL_STEPS },
              animatedStepStyle,
            ]}
          >
            {/* Step 1: Email */}
            <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
              <EmailStep
                email={email}
                onEmailChange={setEmail}
                isEmailValid={isEmailValid}
                isLoading={isLoading && currentStep === 1}
                errorMessage={currentStep === 1 ? errorMessage : ''}
                onContinue={goToNextStep}
                colors={colors}
                t={t}
                isDark={isDark}
                isActive={currentStep === 1}
                onGoogleSignIn={handleGoogleSignIn}
                onAppleSignIn={handleAppleSignIn}
                onFacebookSignIn={handleFacebookSignIn}
                socialAuthLoading={socialAuthLoading}
                socialAuthLoadingProvider={socialAuthLoadingProvider}
                isAppleSignInAvailable={isAppleSignInAvailable}
              />
            </View>

            {/* Step 2: OTP Verification */}
            <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
              <OTPVerificationStep
                email={email}
                code={code}
                onCodeChange={setCode}
                isLoading={isLoading && currentStep === 2}
                errorMessage={currentStep === 2 ? errorMessage : ''}
                onVerify={goToNextStep}
                onResendCode={handleResendCode}
                resendCooldown={resendCooldown}
                canResend={canResend}
                colors={colors}
                t={t}
                isDark={isDark}
                isActive={currentStep === 2}
              />
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

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
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  stepsViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  stepsContainer: {
    flexDirection: 'row',
    flex: 1,
  },
  stepWrapper: {
    height: '100%',
  },
});

export default AuthWizard;
