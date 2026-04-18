/**
 * EmailStep Component
 *
 * First step of the AuthWizard - Email entry with social sign-in buttons.
 * Features a welcoming layout with benefit points, branded social buttons,
 * and a soft divider for email entry.
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { primary } from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { TranslationKey } from '@rallia/shared-translations';
import type { SocialProvider } from '../../hooks/useSocialAuth';

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
  email,
  onEmailChange,
  isEmailValid,
  isLoading,
  errorMessage,
  onContinue,
  colors,
  t,
  isDark,
  isActive = true,
  onGoogleSignIn,
  onAppleSignIn,
  onFacebookSignIn,
  socialAuthLoading = false,
  socialAuthLoadingProvider = null,
  isAppleSignInAvailable = Platform.OS === 'ios',
}) => {
  const emailInputRef = useRef<any>(null);

  // Blur email input when step becomes inactive
  useEffect(() => {
    if (!isActive && emailInputRef.current) {
      emailInputRef.current.blur();
    }
  }, [isActive]);

  const canContinue = isEmailValid && !isLoading && !socialAuthLoading;
  const isAnyLoading = isLoading || socialAuthLoading;

  const benefitIconColor = isDark ? primary[400] : primary[500];

  return (
    <BottomSheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Benefit Points */}
      <View style={styles.benefitsSection}>
        <View style={styles.benefitRow}>
          <Ionicons name="people-outline" size={16} color={benefitIconColor} />
          <Text size="sm" color={colors.textSecondary}>
            {t('auth.benefitFindPartners')}
          </Text>
        </View>
        <View style={styles.benefitRow}>
          <Ionicons name="add-circle-outline" size={16} color={benefitIconColor} />
          <Text size="sm" color={colors.textSecondary}>
            {t('auth.benefitCreateGames')}
          </Text>
        </View>
        <View style={styles.benefitRow}>
          <Ionicons name="globe-outline" size={16} color={benefitIconColor} />
          <Text size="sm" color={colors.textSecondary}>
            {t('auth.benefitJoinCommunity')}
          </Text>
        </View>
      </View>

      {/* Social Sign In Buttons - Full Width with Labels */}
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
                {t('auth.continueWithGoogle')}
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
                  {t('auth.continueWithApple')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Facebook Sign In - commented out; re-enable by uncommenting
        <TouchableOpacity
          style={[
            styles.socialButton,
            { backgroundColor: colors.buttonActive },
            isAnyLoading && styles.socialButtonDisabled,
          ]}
          onPress={onFacebookSignIn}
          activeOpacity={0.8}
          disabled={isAnyLoading}
        >
          {socialAuthLoadingProvider === 'facebook' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="logo-facebook" size={20} color="#fff" />
              <Text size="base" weight="semibold" color="#fff">
                {t('auth.continueWithFacebook')}
              </Text>
            </>
          )}
        </TouchableOpacity>
        */}
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
      <BottomSheetTextInput
        ref={emailInputRef}
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
        editable={isActive}
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
    </BottomSheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[4],
  },
  benefitsSection: {
    paddingHorizontal: spacingPixels[2],
    marginBottom: spacingPixels[5],
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[1.5],
  },
  socialButtons: {
    flexDirection: 'column',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[4],
  },
  socialButton: {
    height: 48,
    borderRadius: radiusPixels.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[3],
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
