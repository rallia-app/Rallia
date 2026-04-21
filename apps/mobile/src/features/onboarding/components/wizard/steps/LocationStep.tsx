/**
 * LocationStep Component
 *
 * Second step of onboarding - collects optional address information.
 * Uses Google Places Autocomplete for address suggestions.
 * Postal code is pre-populated from pre-onboarding with an inline editor for corrections.
 * User can optionally add a specific address for more precise matching.
 * City and postal code are extracted from structured Google Places address components.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Keyboard,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, lightTheme, darkTheme } from '@rallia/design-system';
import { usePlacesAutocomplete, usePostalCodeGeocode } from '@rallia/shared-hooks';
import { checkPostalCodeCoverage } from '@rallia/shared-services';
import {
  lightHaptic,
  isValidCanadianPostalCode,
  formatPostalCodeInput,
} from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';
import type { PlacePrediction } from '@rallia/shared-types';
import type { OnboardingFormData } from '../../../hooks/useOnboardingWizard';
import { useUserHomeLocation } from '../../../../../context/UserLocationContext';
import { SearchBar } from '../../../../../components/SearchBar';

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
  error: string;
}

interface LocationStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

export const LocationStep: React.FC<LocationStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark,
}) => {
  // Get the pre-saved postal code from pre-onboarding
  const { homeLocation } = useUserHomeLocation();
  const { geocode, isLoading: isGeocoding } = usePostalCodeGeocode();
  const [addressQuery, setAddressQuery] = useState(formData.address || '');
  const [hasSelectedAddress, setHasSelectedAddress] = useState(!!formData.address);
  const [selectedAddressName, setSelectedAddressName] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isEditingPostalCode, setIsEditingPostalCode] = useState(false);
  const [editedPostalCode, setEditedPostalCode] = useState('');
  const [postalCodeError, setPostalCodeError] = useState<string | null>(null);

  // The displayed postal code: prefer form data (which reflects user edits) over homeLocation
  const displayPostalCode = formData.postalCode || homeLocation?.postalCode || '';

  // Google Places Autocomplete hook
  const {
    predictions,
    isLoading: isLoadingPredictions,
    clearPredictions,
    getPlaceDetails,
  } = usePlacesAutocomplete({
    searchQuery: addressQuery,
    minQueryLength: 3,
    debounceMs: 300,
  });

  // Listen for keyboard events to adjust padding dynamically
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const keyboardShowListener = Keyboard.addListener(showEvent, e => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const keyboardHideListener = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      keyboardShowListener.remove();
      keyboardHideListener.remove();
    };
  }, []);

  // Sync the pre-populated postal code and coordinates to form data on mount
  useEffect(() => {
    if (homeLocation && !formData.postalCode) {
      onUpdateFormData({
        postalCode: homeLocation.postalCode,
        latitude: homeLocation.latitude,
        longitude: homeLocation.longitude,
      });
    }
  }, [homeLocation, formData.postalCode, onUpdateFormData]);

  // Handle postal code editing
  const handleStartEditPostalCode = () => {
    setEditedPostalCode(formData.postalCode || displayPostalCode);
    setIsEditingPostalCode(true);
  };

  const handlePostalCodeChange = (text: string) => {
    setEditedPostalCode(formatPostalCodeInput(text));
    setPostalCodeError(null);
  };

  const handleSavePostalCode = async () => {
    const trimmed = editedPostalCode.trim();
    if (!trimmed) {
      setIsEditingPostalCode(false);
      return;
    }

    if (!isValidCanadianPostalCode(trimmed)) {
      setPostalCodeError(t('preOnboarding.postalCode.errors.invalid'));
      return;
    }

    // Geocode the postal code to get updated coordinates
    const location = await geocode(trimmed);
    if (location) {
      try {
        const inCoverage = await checkPostalCodeCoverage(location.latitude, location.longitude);
        if (!inCoverage) {
          setPostalCodeError(t('preOnboarding.postalCode.errors.outOfCoverage'));
          return;
        }
      } catch {
        setPostalCodeError(t('preOnboarding.postalCode.errors.coverageCheckFailed'));
        return;
      }
      onUpdateFormData({
        postalCode: trimmed,
        latitude: location.latitude,
        longitude: location.longitude,
      });
    } else {
      // Still save the postal code even if geocoding fails
      onUpdateFormData({ postalCode: trimmed });
    }

    setPostalCodeError(null);
    setIsEditingPostalCode(false);
  };

  const handleCancelEditPostalCode = () => {
    setIsEditingPostalCode(false);
    setEditedPostalCode('');
    setPostalCodeError(null);
  };

  // Handle selecting a place from suggestions
  const handleSelectPlace = useCallback(
    async (prediction: PlacePrediction) => {
      lightHaptic();
      clearPredictions();

      // Set the address immediately
      const fullAddress = prediction.address
        ? `${prediction.name}, ${prediction.address}`
        : prediction.name;
      setAddressQuery(fullAddress);
      setHasSelectedAddress(true);
      setSelectedAddressName(prediction.name);
      onUpdateFormData({ address: fullAddress });

      // Fetch place details to get coordinates and structured address components
      try {
        const details = await getPlaceDetails(prediction.placeId);
        if (details) {
          // Build a street-level display name from address components
          const components = details.addressComponents || [];
          const getComp = (types: string[]): string => {
            const c = components.find(comp => types.some(type => comp.types.includes(type)));
            return c?.longText || '';
          };
          const streetNumber = getComp(['street_number']);
          const route = getComp(['route']);
          const streetAddress = [streetNumber, route].filter(Boolean).join(' ');
          setSelectedAddressName(streetAddress || details.name);

          const updates: Partial<OnboardingFormData> = {
            address: details.address,
            latitude: details.latitude,
            longitude: details.longitude,
          };
          setAddressQuery(details.address);

          // Use structured address components (city, province, postal code) from Google Places API
          if (details.city) {
            updates.city = details.city;
          }
          if (details.province) {
            updates.province = details.province;
          }

          // Sync the postal code if it passes coverage validation
          if (details.postalCode && isValidCanadianPostalCode(details.postalCode)) {
            try {
              const inCoverage = await checkPostalCodeCoverage(details.latitude, details.longitude);
              if (inCoverage) {
                updates.postalCode = details.postalCode;
              }
            } catch {
              // Coverage check failed — keep existing postal code
            }
          }

          onUpdateFormData(updates);
        }
      } catch (error) {
        console.error('Failed to get place details:', error);
      }
    },
    [clearPredictions, getPlaceDetails, onUpdateFormData]
  );

  // Handle clearing the selected address
  const handleClearAddress = useCallback(async () => {
    lightHaptic();
    setHasSelectedAddress(false);
    setSelectedAddressName('');
    setAddressQuery('');
    clearPredictions();
    onUpdateFormData({
      address: '',
      city: '',
      province: '',
    });

    // Re-geocode the postal code to restore its coordinates
    const pc = formData.postalCode || homeLocation?.postalCode;
    if (pc) {
      const location = await geocode(pc);
      if (location) {
        onUpdateFormData({
          latitude: location.latitude,
          longitude: location.longitude,
        });
      } else {
        onUpdateFormData({ latitude: null, longitude: null });
      }
    } else {
      onUpdateFormData({ latitude: null, longitude: null });
    }
  }, [clearPredictions, onUpdateFormData, formData.postalCode, homeLocation?.postalCode, geocode]);

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 20 : spacingPixels[8] },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Title */}
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.locationStep.title')}
      </Text>

      {/* Subtitle */}
      <Text size="sm" color={colors.textSecondary} style={styles.subtitle}>
        {t('onboarding.locationStep.subtitle')}
      </Text>

      {/* Pre-populated Postal Code Display with Edit */}
      {(displayPostalCode || isEditingPostalCode) && (
        <View
          style={[
            styles.postalCodeBadge,
            { backgroundColor: isDark ? darkTheme.card : lightTheme.backgroundSecondary },
          ]}
        >
          {isEditingPostalCode ? (
            <View style={styles.postalCodeEditContainer}>
              <Text
                size="sm"
                weight="semibold"
                color={colors.text}
                style={styles.postalCodeEditLabel}
              >
                {t('onboarding.locationStep.postalCode')}
              </Text>
              <View style={styles.postalCodeEditRow}>
                <TextInput
                  style={[
                    styles.postalCodeEditInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                      color: colors.text,
                    },
                  ]}
                  value={editedPostalCode}
                  onChangeText={handlePostalCodeChange}
                  placeholder={t('onboarding.locationStep.postalCodePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={7}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.postalCodeActionButton, { backgroundColor: colors.buttonActive }]}
                  onPress={handleSavePostalCode}
                  disabled={isGeocoding}
                >
                  {isGeocoding ? (
                    <ActivityIndicator size="small" color={colors.buttonTextActive} />
                  ) : (
                    <Ionicons name="checkmark" size={18} color={colors.buttonTextActive} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.postalCodeActionButton,
                    {
                      backgroundColor: colors.inputBackground,
                      borderWidth: 1,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                  onPress={handleCancelEditPostalCode}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              {postalCodeError && (
                <View style={styles.postalCodeErrorContainer}>
                  <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
                  <Text size="xs" color={colors.error} style={styles.postalCodeErrorText}>
                    {postalCodeError}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.postalCodeBadgeContent}>
              <Ionicons name="checkmark-circle" size={20} color={colors.buttonActive} />
              <View style={styles.postalCodeTextContainer}>
                <Text size="sm" weight="semibold" color={colors.text}>
                  {t('onboarding.locationStep.savedPostalCode')}
                </Text>
                <Text size="lg" weight="bold" color={colors.buttonActive}>
                  {displayPostalCode}
                </Text>
              </View>
              {!hasSelectedAddress && (
                <TouchableOpacity
                  style={styles.postalCodeEditButton}
                  onPress={handleStartEditPostalCode}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="pencil" size={16} color={colors.buttonActive} />
                  <Text size="xs" weight="medium" color={colors.buttonActive}>
                    {t('onboarding.locationStep.editPostalCode')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {/* Optional Address Field with Autocomplete */}
      <View style={styles.inputContainer}>
        <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.inputLabel}>
          {t('onboarding.locationStep.address')}
          <Text size="xs" color={colors.textMuted}>
            {' '}
            ({t('common.optional')})
          </Text>
        </Text>
        <Text size="xs" color={colors.textMuted} style={styles.addressHint}>
          {t('onboarding.locationStep.addressHint')}
        </Text>

        {hasSelectedAddress && formData.address ? (
          <View
            style={[
              styles.selectedAddress,
              { backgroundColor: `${colors.buttonActive}15`, borderColor: colors.buttonActive },
            ]}
          >
            <View style={styles.selectedAddressContent}>
              <Ionicons name="location" size={20} color={colors.buttonActive} />
              <View style={styles.selectedAddressText}>
                <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
                  {selectedAddressName || formData.address}
                </Text>
                <Text size="sm" color={colors.textMuted} numberOfLines={1}>
                  {[formData.city, formData.province, formData.postalCode, 'Canada']
                    .filter(Boolean)
                    .join(', ')}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={handleClearAddress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <SearchBar
              value={addressQuery}
              onChangeText={text => {
                setAddressQuery(text);
                if (!text) clearPredictions();
              }}
              placeholder={t('onboarding.locationStep.addressPlaceholder')}
              colors={colors}
              InputComponent={TextInput}
              autoCapitalize="words"
            />

            {/* Loading state */}
            {isLoadingPredictions && (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color={colors.buttonActive} />
              </View>
            )}

            {/* Place predictions list */}
            {predictions.length > 0 && !isLoadingPredictions && (
              <View style={styles.placeListContainer}>
                {predictions.map(place => (
                  <TouchableOpacity
                    key={place.placeId}
                    style={[
                      styles.placeItem,
                      { backgroundColor: colors.buttonInactive, borderColor: colors.border },
                    ]}
                    onPress={() => handleSelectPlace(place)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.placeItemIcon}>
                      <Ionicons name="location" size={18} color={colors.buttonActive} />
                    </View>
                    <View style={styles.placeItemContent}>
                      <Text size="base" weight="medium" color={colors.text} numberOfLines={1}>
                        {place.name}
                      </Text>
                      {place.address && (
                        <Text size="sm" color={colors.textMuted} numberOfLines={1}>
                          {place.address}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </View>

      {/* Privacy Info Box */}
      <View
        style={[styles.infoBox, { backgroundColor: isDark ? darkTheme.card : lightTheme.muted }]}
      >
        <Ionicons name="shield-checkmark" size={24} color={colors.buttonActive} />
        <View style={styles.infoTextContainer}>
          <Text size="sm" weight="semibold" color={colors.text} style={styles.infoTitle}>
            {t('onboarding.locationStep.privacyTitle')}
          </Text>
          <Text size="xs" color={colors.textSecondary} style={styles.infoText}>
            {t('onboarding.locationStep.privacyDescription')}
          </Text>
        </View>
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
  },
  postalCodeBadge: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[5],
  },
  postalCodeBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  postalCodeTextContainer: {
    flex: 1,
  },
  postalCodeEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[1],
  },
  postalCodeEditContainer: {
    gap: spacingPixels[2],
  },
  postalCodeEditLabel: {
    marginBottom: spacingPixels[1],
  },
  postalCodeEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  postalCodeErrorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1],
    gap: spacingPixels[1],
  },
  postalCodeErrorText: {
    flex: 1,
  },
  postalCodeEditInput: {
    flex: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    fontSize: 16,
    fontWeight: '600' as const,
    borderWidth: 1,
  },
  postalCodeActionButton: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.md,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  inputContainer: {
    marginBottom: spacingPixels[4],
  },
  inputLabel: {
    marginBottom: spacingPixels[1],
  },
  addressHint: {
    marginBottom: spacingPixels[2],
    lineHeight: 16,
  },
  loadingState: {
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
  },
  placeListContainer: {
    marginTop: spacingPixels[3],
  },
  placeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  placeItemIcon: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[2],
  },
  placeItemContent: {
    flex: 1,
  },
  selectedAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  selectedAddressContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  selectedAddressText: {
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[4],
    gap: spacingPixels[3],
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    marginBottom: spacingPixels[1],
  },
  infoText: {
    lineHeight: 18,
  },
});

export default LocationStep;
