/**
 * PostalCodeStep - Second step of the pre-onboarding wizard
 *
 * Collects the user's postal code for location-based match finding.
 * Uses Google Geocoding API to validate and get coordinates.
 * Persuasive UI design to encourage users to provide their location.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, TextInput, Keyboard, Platform, ScrollView } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button, Spinner } from '@rallia/shared-components';
import { SportIcon } from '../../components/SportIcon';
import { spacingPixels, radiusPixels, primary, neutral, status } from '@rallia/design-system';
import { usePostalCodeGeocode, useCoverageCheck } from '@rallia/shared-hooks';
import { selectionHaptic, formatPostalCodeInput } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../hooks';
import { useUserHomeLocation } from '../../context';

interface PostalCodeStepProps {
  /** Called when postal code is verified and user taps Continue */
  onContinue: () => void;
  /** Whether the step is currently active */
  isActive?: boolean;
}

export function PostalCodeStep({ onContinue, isActive = true }: PostalCodeStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const {
    geocode,
    isLoading: isGeocoding,
    error: geocodeError,
    result,
    validateFormat,
    clearResult,
  } = usePostalCodeGeocode();
  const {
    checkCoverage,
    isChecking,
    isInCoverage,
    error: coverageError,
    reset: resetCoverage,
  } = useCoverageCheck();
  const { setHomeLocation } = useUserHomeLocation();

  const [postalCode, setPostalCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [outOfCoverage, setOutOfCoverage] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // Track keyboard height for proper scroll adjustment
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, e => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      setIsInputFocused(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Scroll to input when keyboard shows so the field stays in view (same pattern as WhereStep custom location)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';

    const keyboardShowListener = Keyboard.addListener(showEvent, () => {
      if (isInputFocused && scrollViewRef.current) {
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({ y: 400, animated: true });
        }, 100);
      }
    });

    return () => {
      keyboardShowListener.remove();
    };
  }, [isInputFocused]);

  // Effect 1: Debounced geocoding when format is valid
  // US codes are short-circuited (no US facilities exist yet)
  useEffect(() => {
    const validation = validateFormat(postalCode);
    if (!validation.isValid || !validation.normalized) {
      clearResult();
      resetCoverage();
      setOutOfCoverage(false);
      return;
    }
    // US postal codes: show out-of-coverage immediately, skip geocode
    if (validation.country === 'US') {
      clearResult();
      resetCoverage();
      setOutOfCoverage(true);
      return;
    }
    setOutOfCoverage(false);
    resetCoverage();
    const timer = setTimeout(() => {
      geocode(postalCode);
    }, 500);
    return () => clearTimeout(timer);
  }, [postalCode, validateFormat, geocode, clearResult, resetCoverage]);

  // Effect 2: When geocode succeeds, check coverage via Supabase RPC
  useEffect(() => {
    if (!result) return;

    let cancelled = false;
    checkCoverage(result.latitude, result.longitude).then(inCoverage => {
      if (cancelled) return;
      if (!inCoverage) {
        setOutOfCoverage(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const handlePostalCodeChange = useCallback((text: string) => {
    setPostalCode(formatPostalCodeInput(text));
  }, []);

  const handleContinue = useCallback(async () => {
    if (!result || isSaving) return;

    setIsSaving(true);
    selectionHaptic();

    try {
      await setHomeLocation(result);
      onContinue();
    } catch (err) {
      console.error('Failed to save location:', err);
    } finally {
      setIsSaving(false);
    }
  }, [result, isSaving, setHomeLocation, onContinue]);

  const isLoading = isGeocoding || isChecking;

  const getErrorMessage = (): string | null => {
    if (outOfCoverage) {
      return t('preOnboarding.postalCode.errors.outOfCoverage');
    }
    if (coverageError) {
      return t('preOnboarding.postalCode.errors.coverageCheckFailed');
    }
    if (!geocodeError) return null;

    switch (geocodeError) {
      case 'invalid':
        return t('preOnboarding.postalCode.errors.invalid');
      case 'notFound':
        return t('preOnboarding.postalCode.errors.notFound');
      case 'networkError':
        return t('preOnboarding.postalCode.errors.networkError');
      default:
        return t('preOnboarding.postalCode.errors.invalid');
    }
  };

  const hasValidInput = result !== null && isInCoverage === true;
  const showError =
    (geocodeError && postalCode.length >= 3) ||
    (outOfCoverage && postalCode.length >= 3) ||
    (coverageError && postalCode.length >= 3);
  const errorMessage = getErrorMessage();

  if (!isActive) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.inner,
          { paddingBottom: keyboardHeight > 0 ? keyboardHeight : spacingPixels[4] },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header Section */}
        <Animated.View entering={FadeInDown.delay(50).springify()} style={styles.headerSection}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)' },
            ]}
          >
            <Ionicons
              name="location-outline"
              size={36}
              color={isDark ? primary[400] : primary[600]}
            />
          </View>

          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {t('preOnboarding.postalCode.title')}
          </Text>

          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('preOnboarding.postalCode.subtitle')} {t('preOnboarding.postalCode.coverageNote')}
          </Text>
        </Animated.View>

        {/* Benefits Section */}
        <View style={styles.benefitsSection}>
          {[
            {
              icon: 'people' as const,
              title: t('preOnboarding.postalCode.benefits.findPlayers.title'),
              description: t('preOnboarding.postalCode.benefits.findPlayers.description'),
            },
            {
              icon: 'tennisball' as const,
              title: t('preOnboarding.postalCode.benefits.discoverCourts.title'),
              description: t('preOnboarding.postalCode.benefits.discoverCourts.description'),
            },
            {
              icon: 'calendar' as const,
              title: t('preOnboarding.postalCode.benefits.joinEvents.title'),
              description: t('preOnboarding.postalCode.benefits.joinEvents.description'),
            },
          ].map((benefit, index) => (
            <Animated.View
              key={benefit.icon}
              entering={FadeInDown.delay(100 + index * 100).springify()}
              style={[
                styles.benefitCard,
                {
                  backgroundColor: isDark ? neutral[800] : neutral[50],
                  borderColor: isDark ? neutral[700] : neutral[100],
                },
              ]}
            >
              <View
                style={[
                  styles.benefitIconContainer,
                  {
                    backgroundColor: isDark
                      ? 'rgba(59, 130, 246, 0.15)'
                      : 'rgba(59, 130, 246, 0.1)',
                  },
                ]}
              >
                {benefit.icon === 'tennisball' ? (
                  <SportIcon
                    sportName="tennis"
                    size={20}
                    color={isDark ? primary[400] : primary[600]}
                  />
                ) : (
                  <Ionicons
                    name={benefit.icon}
                    size={20}
                    color={isDark ? primary[400] : primary[600]}
                  />
                )}
              </View>
              <View style={styles.benefitContent}>
                <Text size="sm" weight="semibold" color={colors.foreground}>
                  {benefit.title}
                </Text>
                <Text size="xs" color={colors.textMuted} style={styles.benefitDescription}>
                  {benefit.description}
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>

        {/* Input Section */}
        <Animated.View entering={FadeInDown.delay(400).springify()} style={styles.inputSection}>
          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: isDark ? neutral[800] : neutral[50],
                borderColor: showError
                  ? status.error.DEFAULT
                  : hasValidInput
                    ? status.success.DEFAULT
                    : isDark
                      ? neutral[700]
                      : neutral[200],
              },
            ]}
          >
            <Ionicons
              name="mail-outline"
              size={22}
              color={isDark ? neutral[500] : neutral[400]}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={postalCode}
              onChangeText={handlePostalCodeChange}
              placeholder={t('preOnboarding.postalCode.placeholder')}
              placeholderTextColor={isDark ? neutral[500] : neutral[400]}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
              onFocus={() => setIsInputFocused(true)}
            />
            {isLoading && <Spinner size="sm" style={styles.inputSpinner} />}
            {hasValidInput && !isLoading && (
              <Ionicons name="checkmark-circle-outline" size={24} color={status.success.DEFAULT} />
            )}
          </View>

          {/* Status Message */}
          {isLoading && (
            <Text size="sm" color={colors.textMuted} style={styles.statusText}>
              {t('preOnboarding.postalCode.verifying')}
            </Text>
          )}
          {hasValidInput && !isLoading && (
            <View style={styles.verifiedContainer}>
              <Ionicons name="checkmark-circle-outline" size={16} color={status.success.DEFAULT} />
              <Text size="sm" color={status.success.DEFAULT} style={styles.verifiedText}>
                {t('preOnboarding.postalCode.verified')}
              </Text>
              <Text size="sm" color={colors.textMuted}>
                {' — '}
                {result.formattedAddress}
              </Text>
            </View>
          )}
          {showError && errorMessage && (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle-outline" size={16} color={status.error.DEFAULT} />
              <Text size="sm" color={status.error.DEFAULT} style={styles.errorText}>
                {errorMessage}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Privacy Note */}
        <Animated.View
          entering={FadeInUp.delay(500).springify()}
          style={[
            styles.privacyContainer,
            {
              backgroundColor: isDark ? neutral[800] : neutral[50],
              borderColor: isDark ? neutral[700] : neutral[100],
            },
          ]}
        >
          <Ionicons
            name="shield-checkmark"
            size={16}
            color={isDark ? primary[400] : primary[600]}
          />
          <Text size="xs" color={colors.textMuted} style={styles.privacyText}>
            {t('preOnboarding.postalCode.privacy')}
          </Text>
        </Animated.View>

        {/* Bottom Section */}
        <Animated.View entering={FadeInUp.delay(450).springify()} style={styles.bottomSection}>
          <Button
            variant="primary"
            onPress={handleContinue}
            disabled={!hasValidInput || isSaving}
            style={styles.continueButton}
          >
            {isSaving ? t('common.loading') : t('preOnboarding.postalCode.continue')}
          </Button>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flexGrow: 1,
    paddingHorizontal: spacingPixels[5],
    justifyContent: 'space-between',
    paddingBottom: spacingPixels[4],
  },

  // Header section
  headerSection: {
    paddingTop: spacingPixels[2],
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacingPixels[2],
    paddingTop: spacingPixels[2],
  },

  // Benefits section
  benefitsSection: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
  },
  benefitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  benefitIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  benefitContent: {
    flex: 1,
  },
  benefitDescription: {
    marginTop: 2,
    lineHeight: 16,
  },

  // Input section
  inputSection: {
    marginTop: spacingPixels[4],
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    height: 56,
  },
  inputIcon: {
    marginRight: spacingPixels[3],
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 1,
  },
  inputSpinner: {
    marginLeft: spacingPixels[2],
  },

  // Status messages
  statusText: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  verifiedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2],
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  verifiedText: {
    marginLeft: spacingPixels[1],
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2],
    justifyContent: 'center',
  },
  errorText: {
    marginLeft: spacingPixels[1],
  },

  // Privacy note
  privacyContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginTop: spacingPixels[4],
  },
  privacyText: {
    marginLeft: spacingPixels[2],
    flex: 1,
    lineHeight: 18,
  },

  // Bottom section
  bottomSection: {
    paddingTop: spacingPixels[4],
  },
  continueButton: {
    width: '100%',
  },
});

export default PostalCodeStep;
