/**
 * useAuthWizard Hook
 *
 * Manages authentication wizard state and logic.
 * Extracted from AuthOverlay for reusability in the wizard pattern.
 *
 * Features:
 * - Email OTP flow with validation
 * - Rate limiting on resend (60s cooldown)
 * - User-friendly error messages
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useAuth, useTranslation } from '../../../hooks';
import { supabase } from '../../../lib/supabase';
import { Logger } from '@rallia/shared-services';
import { lightHaptic, mediumHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { checkOnboardingStatus, getFriendlyErrorMessage, RESEND_COOLDOWN_SECONDS } from '../utils';

interface UseAuthWizardOptions {
  /**
   * Callback to show OTP verification errors (wrong/expired code).
   * If provided, this will be called instead of Alert.alert for verification errors.
   * Use this to integrate with toast notifications.
   */
  onVerificationError?: (message: string) => void;
  /**
   * Callback to show general error messages (email submit, resend errors).
   * If provided, this will be called instead of Alert.alert for errors.
   */
  onError?: (message: string) => void;
  /**
   * Callback to show success messages (resend code sent).
   * If provided, this will be called instead of Alert.alert for success.
   */
  onSuccess?: (message: string) => void;
  /**
   * Callback to show warning messages (rate limit cooldown).
   * If provided, this will be called instead of Alert.alert for warnings.
   */
  onWarning?: (message: string) => void;
}

interface UseAuthWizardReturn {
  // State
  email: string;
  setEmail: (email: string) => void;
  code: string;
  setCode: (code: string) => void;
  isLoading: boolean;
  errorMessage: string;

  // Rate limiting
  resendCooldown: number;
  canResend: boolean;

  // Actions
  handleEmailSubmit: () => Promise<boolean>;
  handleResendCode: () => Promise<void>;
  handleVerifyCode: () => Promise<{ success: boolean; needsOnboarding: boolean }>;
  resetState: () => void;

  // Validation
  isEmailValid: boolean;
  isCodeComplete: boolean;
}

/**
 * Email validation regex
 */
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

export function useAuthWizard(options: UseAuthWizardOptions = {}): UseAuthWizardReturn {
  const { onVerificationError, onError, onSuccess, onWarning } = options;
  const { signInWithEmail, verifyOtp } = useAuth();
  const { locale } = useTranslation();

  // State
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Rate limiting state
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Computed
  const isEmailValid = isValidEmail(email);
  const isCodeComplete = code.length === 6;
  const canResend = resendCooldown === 0 && !isLoading;

  /**
   * Start the resend cooldown timer
   */
  const startResendCooldown = useCallback(() => {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);

    // Clear any existing interval
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
    }

    cooldownIntervalRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) {
          if (cooldownIntervalRef.current) {
            clearInterval(cooldownIntervalRef.current);
            cooldownIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
      }
    };
  }, []);

  /**
   * Reset all state
   */
  const resetState = useCallback(() => {
    setEmail('');
    setCode('');
    setErrorMessage('');
    setIsLoading(false);
    setResendCooldown(0);
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
      cooldownIntervalRef.current = null;
    }
  }, []);

  // =============================================================================
  // MESSAGE DISPLAY HELPERS
  // =============================================================================

  /**
   * Show error message using callback or fallback to Alert
   */
  const showError = useCallback(
    (message: string) => {
      if (onError) {
        onError(message);
      } else {
        Alert.alert('Error', message);
      }
    },
    [onError]
  );

  /**
   * Show success message using callback or fallback to Alert
   */
  const showSuccess = useCallback(
    (message: string) => {
      if (onSuccess) {
        onSuccess(message);
      } else {
        Alert.alert('Success', message);
      }
    },
    [onSuccess]
  );

  /**
   * Show warning message using callback or fallback to Alert
   */
  const showWarning = useCallback(
    (message: string) => {
      if (onWarning) {
        onWarning(message);
      } else {
        Alert.alert('Please Wait', message);
      }
    },
    [onWarning]
  );

  /**
   * Show verification error using callback or fallback to Alert
   */
  const showVerificationError = useCallback(
    (message: string) => {
      if (onVerificationError) {
        onVerificationError(message);
      } else {
        Alert.alert('Error', message);
      }
    },
    [onVerificationError]
  );

  // =============================================================================
  // AUTH ACTIONS
  // =============================================================================

  /**
   * Submit email for OTP
   * @returns true if OTP was sent successfully
   */
  const handleEmailSubmit = useCallback(async (): Promise<boolean> => {
    if (!isEmailValid) return false;

    mediumHaptic();
    setIsLoading(true);
    setErrorMessage('');

    try {
      Logger.debug('Sending OTP via Supabase SDK', { emailDomain: email.split('@')[1] });

      const result = await signInWithEmail(email, { data: { locale } });

      if (result.success) {
        Logger.info('OTP sent successfully', { emailDomain: email.split('@')[1] });
        startResendCooldown(); // Start cooldown after successful send
        setIsLoading(false);
        return true;
      } else {
        const friendlyError = getFriendlyErrorMessage(result.error);
        setErrorMessage(friendlyError);
        showError(friendlyError);
        warningHaptic();
        setIsLoading(false);
        return false;
      }
    } catch (error) {
      Logger.error('Failed to send OTP', error as Error, { emailDomain: email.split('@')[1] });
      const friendlyError = getFriendlyErrorMessage(error);
      setErrorMessage(friendlyError);
      showError(friendlyError);
      warningHaptic();
      setIsLoading(false);
      return false;
    }
  }, [email, isEmailValid, locale, signInWithEmail, startResendCooldown, showError]);

  /**
   * Resend verification code (with rate limiting)
   */
  const handleResendCode = useCallback(async (): Promise<void> => {
    // Check rate limiting
    if (!canResend) {
      warningHaptic();
      if (resendCooldown > 0) {
        showWarning(`You can request a new code in ${resendCooldown} seconds.`);
      }
      return;
    }

    lightHaptic();
    setIsLoading(true);
    setErrorMessage('');
    setCode(''); // Clear the input field when resending

    try {
      const result = await signInWithEmail(email, { data: { locale } });

      if (result.success) {
        Logger.info('OTP resent successfully', { emailDomain: email.split('@')[1] });
        setCode(''); // Clear any code currently entered so user can type the new one
        startResendCooldown(); // Start cooldown after successful resend
        showSuccess('Verification code sent!');
      } else {
        const friendlyError = getFriendlyErrorMessage(result.error);
        setErrorMessage(friendlyError);
        showError(friendlyError);
        warningHaptic();
      }
    } catch (error) {
      Logger.error('Failed to resend OTP', error as Error, { emailDomain: email.split('@')[1] });
      const friendlyError = getFriendlyErrorMessage(error);
      setErrorMessage(friendlyError);
      showError(friendlyError);
      warningHaptic();
    } finally {
      setIsLoading(false);
    }
  }, [
    email,
    locale,
    signInWithEmail,
    canResend,
    resendCooldown,
    startResendCooldown,
    showError,
    showSuccess,
    showWarning,
  ]);

  /**
   * Verify OTP code
   * @returns object with success status and whether user needs onboarding
   */
  const handleVerifyCode = useCallback(async (): Promise<{
    success: boolean;
    needsOnboarding: boolean;
  }> => {
    if (code.length !== 6) {
      warningHaptic();
      showVerificationError('Please enter all 6 digits');
      return { success: false, needsOnboarding: false };
    }

    mediumHaptic();
    setIsLoading(true);
    setErrorMessage('');

    try {
      Logger.debug('Verifying OTP via Supabase SDK', {
        emailDomain: email.split('@')[1],
        codeLength: code.length,
      });

      const result = await verifyOtp(email, code);

      if (!result.success) {
        const friendlyError = getFriendlyErrorMessage(result.error);
        setErrorMessage(friendlyError);
        showVerificationError(friendlyError);
        warningHaptic();
        setIsLoading(false);
        return { success: false, needsOnboarding: false };
      }

      // Use the user returned directly from verifyOtp (no need to fetch session separately)
      const userId = result.user?.id;

      if (!userId) {
        Logger.error('No user ID after OTP verification', new Error('Missing userId'));
        const friendlyError = 'Authentication failed. Please try again.';
        setErrorMessage(friendlyError);
        showVerificationError(friendlyError);
        warningHaptic();
        setIsLoading(false);
        return { success: false, needsOnboarding: false };
      }

      Logger.info('User authenticated successfully', { userId, emailDomain: email.split('@')[1] });

      // Store current locale in auth user_metadata so the next OTP email is in the right language
      supabase.auth.updateUser({ data: { locale } }).then(({ error: updateError }) => {
        if (updateError) {
          Logger.debug('Could not sync locale to auth user_metadata', {
            error: updateError.message,
          });
        }
      });

      // Check onboarding status using shared utility
      const needsOnboarding = await checkOnboardingStatus(userId);

      Logger.logNavigation(
        needsOnboarding ? 'new_user_start_onboarding' : 'returning_user_skip_onboarding',
        {
          userId,
          needsOnboarding,
        }
      );

      successHaptic();
      setIsLoading(false);
      return { success: true, needsOnboarding };
    } catch (error) {
      Logger.error('Error during OTP verification', error as Error);
      const friendlyError = getFriendlyErrorMessage(error);
      setErrorMessage(friendlyError);
      showVerificationError(friendlyError);
      warningHaptic();
      setIsLoading(false);
      return { success: false, needsOnboarding: false };
    }
  }, [code, email, locale, verifyOtp, showVerificationError]);

  return {
    // State
    email,
    setEmail,
    code,
    setCode,
    isLoading,
    errorMessage,

    // Rate limiting
    resendCooldown,
    canResend,

    // Actions
    handleEmailSubmit,
    handleResendCode,
    handleVerifyCode,
    resetState,

    // Validation
    isEmailValid,
    isCodeComplete,
  };
}

export default useAuthWizard;
