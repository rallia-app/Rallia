/**
 * EmailStep Component
 *
 * First step of the AuthWizard - Email entry with social sign-in buttons.
 * Features a welcoming layout with benefit points, branded social buttons,
 * and a soft divider for email entry.
 */

import React from 'react';
import type { RefObject } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
  TextInput,
} from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { primary, spacingPixels, radiusPixels } from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import type { TranslationKey } from '@rallia/shared-translations';

import type { SocialProvider } from '#/features/auth/hooks/useSocialAuth';

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

interface EmailStepProps {
  /**
   * Ref to the email TextInput, owned by the parent wizard. Letting the
   * parent hold the ref enables imperative focus transfer during step
   * transitions (keeps the keyboard open when navigating back from OTP).
   */
  inputRef: RefObject<TextInput | null>;
  email: string;
  onEmailChange: (email: string) => void;
  isEmailValid: boolean;
  isLoading: boolean;
  errorMessage: string;
  onContinue: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
  /** Whether this step is currently active/visible */
  isActive?: boolean;
  /** Social auth handlers */
  onGoogleSignIn?: () => void;
  onAppleSignIn?: () => void;
  onFacebookSignIn?: () => void;
  /** Social auth loading state */
  socialAuthLoading?: boolean;
  socialAuthLoadingProvider?: SocialProvider | null;
  /** Whether Apple Sign-In is available (iOS 13+ only) */
  isAppleSignInAvailable?: boolean;
}

export const EmailStep: React.FC<EmailStepProps> = ({
  inputRef,
  email,
  onEmailChange,
  isEmailValid,
  isLoading,
  errorMessage,
  onContinue,
  colors,
  t,
  onGoogleSignIn,
  onAppleSignIn,
  onFacebookSignIn,
  socialAuthLoading = false,
  socialAuthLoadingProvider = null,
  isAppleSignInAvailable = Platform.OS === 'ios',
}) => {
  // Note: don't explicitly blur on !isActive. When advancing to the OTP step,
  // focusing the OTP input will remove focus here automatically, and doing so
  // keeps the keyboard open across the step transition. An explicit blur here
  // would dismiss the keyboard in the gap before OTP focuses.

  const canContinue = isEmailValid && !isLoading && !socialAuthLoading;
  const isAnyLoading = isLoading || socialAuthLoading;

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Social Sign In Buttons - Compact row with icon + brand name */}
      <View style={styles.socialButtons}>
        {/* Google Sign In */}
        <TouchableOpacity
          style={[
            styles.socialButton,
            { backgroundColor: colors.buttonActive },
            isAnyLoading && styles.socialButtonDisabled,
          ]}
          onPress={onGoogleSignIn}
          activeOpacity={0.8}
          disabled={isAnyLoading}
        >
          {socialAuthLoadingProvider === 'google' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="logo-google" size={20} color="#fff" />
              <Text size="base" weight="semibold" color="#fff">
                Google
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Apple Sign In - iOS only */}
        {isAppleSignInAvailable && (
          <TouchableOpacity
            style={[
              styles.socialButton,
              { backgroundColor: colors.buttonActive },
              isAnyLoading && styles.socialButtonDisabled,
            ]}
            onPress={onAppleSignIn}
            activeOpacity={0.8}
            disabled={isAnyLoading}
          >
            {socialAuthLoadingProvider === 'apple' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="logo-apple" size={20} color="#fff" />
                <Text size="base" weight="semibold" color="#fff">
                  Apple
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* OR Divider - softer "or continue with email" */}
      <View style={styles.dividerContainer}>
        <View style={[styles.dividerLine, { backgroundColor: colors.divider }]} />
        <Text size="sm" weight="medium" color={colors.textMuted} style={styles.dividerText}>
          {t('auth.continueWithEmail')}
        </Text>
        <View style={[styles.dividerLine, { backgroundColor: colors.divider }]} />
      </View>

      {/* Email Input */}
      <TextInput
        ref={inputRef}
        testID="auth-email-input"
        style={[
          styles.emailInput,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
            color: colors.text,
          },
        ]}
        placeholder={t('auth.email')}
        placeholderTextColor={colors.textMuted}
        value={email}
        onChangeText={onEmailChange}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
      />

      {/* Continue Button */}
      <TouchableOpacity
        style={[
          styles.continueButton,
          { backgroundColor: canContinue ? colors.buttonActive : colors.buttonInactive },
        ]}
        onPress={canContinue ? onContinue : undefined}
        activeOpacity={canContinue ? 0.8 : 1}
        disabled={!canContinue}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.buttonTextActive} />
        ) : (
          <Text
            size="lg"
            weight="semibold"
            color={canContinue ? colors.buttonTextActive : colors.textMuted}
          >
            {t('common.continue')}
          </Text>
        )}
      </TouchableOpacity>

      {/* Terms Text */}
      <Text size="xs" color={colors.textMuted} style={styles.termsText}>
        {t('auth.termsPrefix')}
        <Text
          size="xs"
          color={primary[500]}
          style={styles.termsLink}
          onPress={() => Linking.openURL('https://rallia.ca/terms')}
        >
          {t('auth.termsLink')}
        </Text>
        {t('auth.termsMiddle')}
        <Text
          size="xs"
          color={primary[500]}
          style={styles.termsLink}
          onPress={() => Linking.openURL('https://rallia.ca/privacy')}
        >
          {t('auth.privacyLink')}
        </Text>
        {t('auth.termsSuffix')}
      </Text>
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {},
  contentContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[4],
  },
  socialButtons: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[5],
  },
  socialButton: {
    flex: 1,
    height: 48,
    borderRadius: radiusPixels.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[2],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  socialButtonDisabled: {
    opacity: 0.6,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[6],
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: spacingPixels[3],
  },
  emailInput: {
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
    fontSize: 16,
    marginBottom: spacingPixels[4],
    borderWidth: 1,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  continueButton: {
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[4],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  termsText: {
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    textDecorationLine: 'underline',
  },
});

export default EmailStep;
