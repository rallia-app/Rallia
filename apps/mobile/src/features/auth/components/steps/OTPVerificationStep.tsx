/**
 * OTPVerificationStep Component
 *
 * Second step of the AuthWizard - 6-digit OTP code verification.
 * Migrated from AuthOverlay with theme-aware colors and i18n support.
 */

import React, { useEffect, useCallback } from 'react';
import type { RefObject } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, Pressable, Platform } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { TranslationKey } from '@rallia/shared-translations';

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
  inputBackground: string;
  inputBorder: string;
  inputBorderFocused: string;
  error: string;
  success: string;
  divider: string;
}

interface OTPVerificationStepProps {
  /**
   * Ref to the hidden OTP TextInput, owned by the parent wizard. The parent
   * focuses it imperatively during the step transition so the keyboard
   * stays open across the slide.
   */
  hiddenInputRef: RefObject<TextInput | null>;
  email: string;
  code: string;
  onCodeChange: (code: string) => void;
  isLoading: boolean;
  errorMessage: string;
  onVerify: () => void;
  onResendCode: () => void;
  /** Seconds remaining before resend is allowed */
  resendCooldown?: number;
  /** Whether resend button is enabled */
  canResend?: boolean;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
  /** Whether this step is currently active/visible */
  isActive?: boolean;
}

export const OTPVerificationStep: React.FC<OTPVerificationStepProps> = ({
  hiddenInputRef,
  email,
  code,
  onCodeChange,
  isLoading,
  errorMessage: _errorMessage,
  onVerify,
  onResendCode,
  resendCooldown = 0,
  canResend = true,
  colors,
  t,
  isDark,
  isActive = true,
}) => {
  // Re-focus when the step becomes active — covers the case where focus was
  // lost (e.g., user tapped outside the hidden input) after the initial
  // imperative focus from the parent wizard.
  useEffect(() => {
    if (isActive && hiddenInputRef.current) {
      hiddenInputRef.current.focus();
    }
  }, [isActive, hiddenInputRef]);

  // Handler for code input changes - memoized for performance
  const handleCodeChange = useCallback(
    (text: string) => {
      // Only accept digits, limit to 6 characters
      const cleanedCode = text.replace(/[^0-9]/g, '').slice(0, 6);
      onCodeChange(cleanedCode);
    },
    [onCodeChange]
  );

  // Focus the hidden input when tapping the code boxes
  const focusHiddenInput = useCallback(() => {
    hiddenInputRef.current?.focus();
  }, [hiddenInputRef]);

  const isCodeComplete = code.length === 6;
  const canVerify = isCodeComplete && !isLoading;

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Title */}
      <Text size="2xl" weight="bold" color={colors.text} style={styles.title}>
        {t('auth.verificationCode')}
      </Text>

      {/* Description */}
      <Text size="base" color={colors.textSecondary} style={styles.description}>
        {t('auth.codeSentTo')}
        {'\n'}
        <Text size="base" weight="semibold" color={colors.text}>
          {email}
        </Text>
      </Text>

      {/* Hidden TextInput for smooth OTP entry.
          Always editable so the parent wizard can focus it before the step
          becomes visible (needed to keep the keyboard open across the slide). */}
      <TextInput
        ref={hiddenInputRef}
        testID="otp-code-input"
        style={styles.hiddenInput}
        value={code}
        onChangeText={handleCodeChange}
        keyboardType={Platform.OS === 'ios' && Platform.isPad ? 'decimal-pad' : 'number-pad'}
        maxLength={6}
        caretHidden
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        inputMode="numeric"
      />

      {/* Visual Code Display Boxes */}
      <Pressable
        style={styles.codeInputContainer}
        onPress={focusHiddenInput}
        testID="otp-code-boxes"
      >
        {Array.from({ length: 6 }).map((_, index) => {
          const digit = code[index] || '';
          const isFilled = digit !== '';
          return (
            <View
              key={index}
              style={[
                styles.codeBox,
                {
                  backgroundColor: isFilled ? colors.cardBackground : colors.inputBackground,
                  borderColor: isFilled ? colors.buttonActive : colors.inputBorder,
                },
              ]}
            >
              <Text size="xl" weight="semibold" color={colors.text}>
                {digit}
              </Text>
            </View>
          );
        })}
      </Pressable>

      {/* Resend Code Button */}
      <TouchableOpacity
        style={[
          styles.resendButton,
          {
            backgroundColor: canResend
              ? isDark
                ? colors.buttonInactive
                : `${colors.buttonActive}15`
              : colors.buttonInactive,
            opacity: canResend ? 1 : 0.6,
          },
        ]}
        onPress={onResendCode}
        activeOpacity={canResend ? 0.8 : 1}
        disabled={!canResend || isLoading}
      >
        <Text
          size="base"
          weight="semibold"
          color={canResend ? colors.buttonActive : colors.textMuted}
        >
          {resendCooldown > 0
            ? `${t('auth.resendCode')} (${resendCooldown}s)`
            : t('auth.resendCode')}
        </Text>
      </TouchableOpacity>

      {/* Continue Button */}
      <TouchableOpacity
        style={[
          styles.continueButton,
          { backgroundColor: canVerify ? colors.buttonActive : colors.buttonInactive },
        ]}
        onPress={canVerify ? onVerify : undefined}
        activeOpacity={canVerify ? 0.8 : 1}
        disabled={!canVerify}
      >
        <Text
          size="lg"
          weight="semibold"
          color={canVerify ? colors.buttonTextActive : colors.textMuted}
        >
          {t('common.continue')}
        </Text>
      </TouchableOpacity>
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {},
  contentContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[8],
    paddingBottom: spacingPixels[4],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  description: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacingPixels[6],
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: Platform.OS === 'ios' && (Platform as any).isPad ? 50 : 1,
    height: Platform.OS === 'ios' && (Platform as any).isPad ? 50 : 1,
    opacity: 0.01,
  },
  codeInputContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[6],
  },
  codeBox: {
    width: 45,
    height: 55,
    borderRadius: radiusPixels.md,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resendButton: {
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[4],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  continueButton: {
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[4],
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
});

export default OTPVerificationStep;
