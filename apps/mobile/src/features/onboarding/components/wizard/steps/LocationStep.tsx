/**
 * LocationStep Component
 *
 * Recovery step shown only when no postal code is known for the player
 * (pre-onboarding's hand-off missing on both the device and the player row).
 * Mirrors pre-onboarding's PostalCodeStep: debounced geocode + coverage
 * check; writes postalCode/latitude/longitude into formData once verified.
 * OnboardingWizard persists them on Next.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TextInput, Keyboard } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Spinner } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { usePostalCodeGeocode, useCoverageCheck } from '@rallia/shared-hooks';
import { formatPostalCodeInput } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';

import type { OnboardingFormData } from '#/features/onboarding/hooks/useOnboardingWizard';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  inputBackground: string;
  inputBorder: string;
  error: string;
  success: string;
}

interface LocationStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

const GEOCODE_DEBOUNCE_MS = 500;

export const LocationStep: React.FC<LocationStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
}) => {
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
    error: coverageError,
    reset: resetCoverage,
  } = useCoverageCheck();

  const [input, setInput] = useState(formData.postalCode);
  // Set by the coverage check; cleared on every edit (handleChange).
  const [noCoverage, setNoCoverage] = useState(false);

  const verified =
    formData.postalCode.trim() !== '' && formData.latitude !== null && formData.longitude !== null;
  const validation = validateFormat(input);
  const inputIsVerified = verified && validation.normalized === formData.postalCode;
  // US codes are short-circuited: no US facilities exist yet.
  const outOfCoverage = noCoverage || validation.country === 'US';

  // Debounced geocode once the format is valid and not already verified.
  useEffect(() => {
    const current = validateFormat(input);
    if (!current.isValid || !current.normalized || current.country === 'US') {
      clearResult();
      resetCoverage();
      return;
    }
    if (verified && current.normalized === formData.postalCode) return;
    resetCoverage();
    const timer = setTimeout(() => {
      void geocode(input);
    }, GEOCODE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, validateFormat, geocode, clearResult, resetCoverage, verified, formData.postalCode]);

  // Geocode succeeded: confirm coverage, then commit to the form.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    void checkCoverage(result.latitude, result.longitude).then(inCoverage => {
      if (cancelled) return;
      if (!inCoverage) {
        setNoCoverage(true);
        return;
      }
      onUpdateFormData({
        postalCode: result.postalCode,
        latitude: result.latitude,
        longitude: result.longitude,
        city: result.city ?? '',
        province: result.province ?? '',
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const handleChange = (text: string) => {
    const next = formatPostalCodeInput(text);
    setInput(next);
    setNoCoverage(false);
    // Any edit invalidates the previously verified coordinates.
    if (validateFormat(next).normalized !== formData.postalCode) {
      onUpdateFormData({ postalCode: '', latitude: null, longitude: null });
    }
  };

  const isLoading = isGeocoding || isChecking;
  const showError = input.length >= 3 && (outOfCoverage || !!coverageError || !!geocodeError);

  const errorMessage = (): string | null => {
    if (outOfCoverage) return t('preOnboarding.postalCode.errors.outOfCoverage');
    if (coverageError) return t('preOnboarding.postalCode.errors.coverageCheckFailed');
    switch (geocodeError) {
      case 'notFound':
        return t('preOnboarding.postalCode.errors.notFound');
      case 'networkError':
        return t('preOnboarding.postalCode.errors.networkError');
      default:
        return geocodeError ? t('preOnboarding.postalCode.errors.invalid') : null;
    }
  };

  const borderColor = showError
    ? colors.error
    : inputIsVerified
      ? colors.success
      : colors.inputBorder;

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.locationStep.postalCodeTitle')}
      </Text>
      <Text size="sm" color={colors.textSecondary} style={styles.subtitle}>
        {t('onboarding.locationStep.postalCodeSubtitle')}
      </Text>

      <Text size="sm" weight="semibold" color={colors.text} style={styles.label}>
        {t('onboarding.locationStep.postalCode')}
      </Text>
      <View
        style={[styles.inputContainer, { backgroundColor: colors.inputBackground, borderColor }]}
      >
        <Ionicons
          name="location-outline"
          size={20}
          color={colors.textMuted}
          style={styles.inputIcon}
        />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={input}
          onChangeText={handleChange}
          placeholder={t('onboarding.locationStep.postalCodePlaceholder')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
          accessibilityLabel={t('onboarding.locationStep.postalCode')}
        />
        {isLoading && <Spinner size="sm" />}
        {inputIsVerified && !isLoading && (
          <Ionicons name="checkmark-circle-outline" size={22} color={colors.success} />
        )}
      </View>

      <View style={styles.statusSlot}>
        {isLoading && (
          <Text size="sm" color={colors.textMuted} style={styles.statusText}>
            {t('preOnboarding.postalCode.verifying')}
          </Text>
        )}
        {!isLoading && inputIsVerified && (
          <View style={styles.statusRow}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
            <Text size="sm" color={colors.success} style={styles.statusInline}>
              {t('preOnboarding.postalCode.verified')}
            </Text>
          </View>
        )}
        {!isLoading && showError && (
          <View style={styles.statusRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text size="sm" color={colors.error} style={styles.statusInline}>
              {errorMessage()}
            </Text>
          </View>
        )}
        {!isLoading && !inputIsVerified && !showError && (
          <Text size="xs" color={colors.textMuted} style={styles.statusText}>
            {t('preOnboarding.postalCode.statusHint')}
          </Text>
        )}
      </View>

      <View style={styles.privacyRow}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.buttonActive} />
        <Text size="xs" color={colors.textMuted} style={styles.statusInline}>
          {t('preOnboarding.postalCode.privacy')}
        </Text>
      </View>
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    flexGrow: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
    lineHeight: 20,
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[2],
  },
  inputIcon: {
    marginRight: spacingPixels[1],
  },
  input: {
    flex: 1,
    fontSize: fontSizePixels.base,
    letterSpacing: 1,
  },
  statusSlot: {
    marginTop: spacingPixels[2],
    minHeight: 44,
  },
  statusText: {
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  statusInline: {
    marginLeft: spacingPixels[1],
    flexShrink: 1,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[6],
    paddingHorizontal: spacingPixels[2],
  },
});

export default LocationStep;
