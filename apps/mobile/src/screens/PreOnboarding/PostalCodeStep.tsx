/**
 * PostalCodeStep - Second step of the pre-onboarding wizard
 *
 * Collects the user's postal code for location-based match finding.
 * Uses Google Geocoding API to validate and get coordinates.
 * Persuasive UI design to encourage users to provide their location.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, TextInput, Keyboard, TouchableWithoutFeedback } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button, Spinner } from '@rallia/shared-components';
import { SportIcon } from '../../components/SportIcon';
import {
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
  shadowsNative,
} from '@rallia/design-system';
import {
  usePostalCodeGeocode,
  useCoverageCheck,
  type PostalCodeLocation,
} from '@rallia/shared-hooks';
import { selectionHaptic, formatPostalCodeInput } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../hooks';
import { useUserHomeLocation } from '../../context';

interface PostalCodeStepProps {
  /** Current postal code input, owned by the parent so it survives remounts. */
  postalCode: string;
  onPostalCodeChange: (code: string) => void;
  /** Cached verified geocode so returning to this step skips re-geocoding. */
  verifiedResult: PostalCodeLocation | null;
  onVerifiedResultChange: (result: PostalCodeLocation | null) => void;
  /** Called when postal code is verified and user taps Continue */
  onContinue: () => void;
  /** Whether the step is currently active */
  isActive?: boolean;
}

export function PostalCodeStep({
  postalCode,
  onPostalCodeChange,
  verifiedResult,
  onVerifiedResultChange,
  onContinue,
  isActive = true,
}: PostalCodeStepProps) {
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

  const [isSaving, setIsSaving] = useState(false);
  const [outOfCoverage, setOutOfCoverage] = useState(false);

  // Effect 1: Debounced geocoding when format is valid
  // US codes are short-circuited (no US facilities exist yet)
  // If parent already has a cached verifiedResult matching this postal code,
  // skip the geocode so returning to this step doesn't flicker.
  useEffect(() => {
    const validation = validateFormat(postalCode);
    if (!validation.isValid || !validation.normalized) {
      clearResult();
      resetCoverage();
      setOutOfCoverage(false);
      if (verifiedResult) onVerifiedResultChange(null);
      return;
    }
    // US postal codes: show out-of-coverage immediately, skip geocode
    if (validation.country === 'US') {
      clearResult();
      resetCoverage();
      setOutOfCoverage(true);
      if (verifiedResult) onVerifiedResultChange(null);
      return;
    }
    // Already verified — no work to do.
    if (verifiedResult && verifiedResult.postalCode === validation.normalized) {
      setOutOfCoverage(false);
      return;
    }
    setOutOfCoverage(false);
    resetCoverage();
    const timer = setTimeout(() => {
      geocode(postalCode);
    }, 500);
    return () => clearTimeout(timer);
  }, [
    postalCode,
    validateFormat,
    geocode,
    clearResult,
    resetCoverage,
    verifiedResult,
    onVerifiedResultChange,
  ]);

  // Effect 2: When geocode succeeds, check coverage and cache the verified
  // location on the parent so back/forward navigation doesn't lose it.
  useEffect(() => {
    if (!result) return;

    let cancelled = false;
    checkCoverage(result.latitude, result.longitude).then(inCoverage => {
      if (cancelled) return;
      if (!inCoverage) {
        setOutOfCoverage(true);
        onVerifiedResultChange(null);
      } else {
        onVerifiedResultChange(result);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const handlePostalCodeChange = useCallback(
    (text: string) => {
      onPostalCodeChange(formatPostalCodeInput(text));
    },
    [onPostalCodeChange]
  );

  const handleContinue = useCallback(async () => {
    if (!verifiedResult || isSaving) return;

    setIsSaving(true);
    selectionHaptic();

    try {
      await setHomeLocation(verifiedResult);
      onContinue();
    } catch (err) {
      console.error('Failed to save location:', err);
    } finally {
      setIsSaving(false);
    }
  }, [verifiedResult, isSaving, setHomeLocation, onContinue]);

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

  const normalizedCurrent = validateFormat(postalCode).normalized;
  const hasValidInput =
    verifiedResult !== null &&
    normalizedCurrent !== null &&
    verifiedResult.postalCode === normalizedCurrent &&
    !outOfCoverage;
  const showError =
    (geocodeError && postalCode.length >= 3) ||
    (outOfCoverage && postalCode.length >= 3) ||
    (coverageError && postalCode.length >= 3);
  const errorMessage = getErrorMessage();

  return (
    <View style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.inner}>
          {/* Header Section */}
          <Animated.View entering={FadeInDown.delay(50).springify()} style={styles.headerSection}>
            <LinearGradient
              colors={isDark ? [primary[800], primary[900]] : [primary[50], primary[100]]}
              style={styles.iconContainer}
            >
              <Ionicons
                name="location-outline"
                size={36}
                color={isDark ? primary[200] : primary[600]}
              />
            </LinearGradient>

            <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
              {t('preOnboarding.postalCode.title')}
            </Text>

            <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
              {t('preOnboarding.postalCode.subtitle')} {t('preOnboarding.postalCode.coverageNote')}
            </Text>
          </Animated.View>

          {/* Input Section */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.inputSection}>
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
              />
              {isLoading && <Spinner size="sm" style={styles.inputSpinner} />}
              {hasValidInput && !isLoading && (
                <Ionicons
                  name="checkmark-circle-outline"
                  size={24}
                  color={status.success.DEFAULT}
                />
              )}
            </View>

            {/* Status Message — reserved space so layout doesn't shift */}
            <View style={styles.statusSlot}>
              {!isLoading && !hasValidInput && !showError && (
                <Text size="xs" color={colors.textMuted} style={styles.statusText}>
                  {t('preOnboarding.postalCode.statusHint')}
                </Text>
              )}
              {isLoading && (
                <Text size="sm" color={colors.textMuted} style={styles.statusText}>
                  {t('preOnboarding.postalCode.verifying')}
                </Text>
              )}
              {hasValidInput && !isLoading && (
                <View style={styles.verifiedContainer}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={16}
                    color={status.success.DEFAULT}
                  />
                  <Text size="sm" color={status.success.DEFAULT} style={styles.verifiedText}>
                    {t('preOnboarding.postalCode.verified')}
                  </Text>
                  <Text size="sm" color={colors.textMuted}>
                    {' — '}
                    {verifiedResult?.formattedAddress}
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
            </View>
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
                entering={FadeInDown.delay(250 + index * 100).springify()}
                style={styles.benefitRow}
              >
                <View
                  style={[
                    styles.benefitIconContainer,
                    {
                      backgroundColor: isDark ? 'rgba(115, 115, 115, 0.18)' : neutral[100],
                    },
                  ]}
                >
                  {benefit.icon === 'tennisball' ? (
                    <SportIcon
                      sportName="tennis"
                      size={18}
                      color={isDark ? neutral[400] : neutral[500]}
                    />
                  ) : (
                    <Ionicons
                      name={benefit.icon}
                      size={18}
                      color={isDark ? neutral[400] : neutral[500]}
                    />
                  )}
                </View>
                <View style={styles.benefitContent}>
                  <Text size="base" weight="semibold" color={colors.foreground}>
                    {benefit.title}
                  </Text>
                  <Text size="sm" color={colors.textMuted} style={styles.benefitDescription}>
                    {benefit.description}
                  </Text>
                </View>
              </Animated.View>
            ))}
          </View>
        </View>
      </TouchableWithoutFeedback>

      {/* Bottom Section (pinned) */}
      <Animated.View entering={FadeInUp.delay(450).springify()} style={styles.bottomSection}>
        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={!hasValidInput || isSaving}
          style={styles.continueButton}
        >
          {isSaving ? t('common.loading') : t('preOnboarding.postalCode.continue')}
        </Button>

        <View style={styles.privacyContainer}>
          <Ionicons
            name="shield-checkmark"
            size={14}
            color={isDark ? primary[400] : primary[600]}
          />
          <Text size="xs" color={colors.textMuted} style={styles.privacyText}>
            {t('preOnboarding.postalCode.privacy')}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: spacingPixels[5],
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
    ...shadowsNative.md,
    shadowColor: primary[500],
    shadowOpacity: 0.25,
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
    marginTop: spacingPixels[10],
    gap: spacingPixels[8],
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  benefitIconContainer: {
    width: 32,
    height: 32,
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
    marginTop: spacingPixels[8],
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
  statusSlot: {
    marginTop: spacingPixels[2],
    minHeight: 44,
  },
  statusText: {
    textAlign: 'center',
  },
  verifiedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  verifiedText: {
    marginLeft: spacingPixels[1],
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    marginLeft: spacingPixels[1],
  },

  // Privacy note
  privacyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[5],
    paddingHorizontal: spacingPixels[2],
  },
  privacyText: {
    marginLeft: spacingPixels[2],
    textAlign: 'center',
    lineHeight: 18,
  },

  // Bottom section (pinned outside scroll)
  bottomSection: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[4],
    alignItems: 'center',
  },
  continueButton: {
    width: '100%',
  },
});

export default PostalCodeStep;
