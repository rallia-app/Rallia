import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Text, useToast } from '@rallia/shared-components';
import { supabase, Logger, checkPostalCodeCoverage } from '@rallia/shared-services';
import { spacingPixels, radiusPixels, darkTheme, lightTheme } from '@rallia/design-system';
import { usePlacesAutocomplete, usePostalCodeGeocode } from '@rallia/shared-hooks';
import {
  lightHaptic,
  mediumHaptic,
  isValidCanadianPostalCode,
  formatPostalCodeInput,
} from '@rallia/shared-utils';
import type { PlacePrediction } from '@rallia/shared-types';
import { useThemeStyles, usePlayer, useTranslation } from '../../../../hooks';
import { useUserHomeLocation } from '../../../../context/UserLocationContext';
import { SearchBar } from '../../../../components/SearchBar';

export function LocationActionSheet({ payload }: SheetProps<'player-location'>) {
  const onSave = payload?.onSave;
  const initialData = payload?.initialData;
  const onClose = () => SheetManager.hide('player-location');
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { refetch: refetchPlayer } = usePlayer();
  const { setHomeLocation } = useUserHomeLocation();
  const { geocode, isLoading: isGeocoding } = usePostalCodeGeocode();

  // Local state
  const [postalCode, setPostalCode] = useState(initialData?.postalCode || '');
  const [address, setAddress] = useState(initialData?.address || '');
  const [city, setCity] = useState(initialData?.city || '');
  const [province, setProvince] = useState(initialData?.province || '');
  const [latitude, setLatitude] = useState<number | null>(initialData?.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(initialData?.longitude ?? null);

  // Postal code editing state
  const [isEditingPostalCode, setIsEditingPostalCode] = useState(false);
  const [editedPostalCode, setEditedPostalCode] = useState('');
  const [postalCodeError, setPostalCodeError] = useState<string | null>(null);

  // Address search state
  const [addressQuery, setAddressQuery] = useState('');
  const [hasSelectedAddress, setHasSelectedAddress] = useState(!!initialData?.address);
  const [selectedAddressName, setSelectedAddressName] = useState(initialData?.address || '');
  const [isSaving, setIsSaving] = useState(false);

  // Google Places Autocomplete
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

  // Postal code editing handlers
  const handleStartEditPostalCode = () => {
    setEditedPostalCode(postalCode);
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
      setPostalCode(trimmed);
      setLatitude(location.latitude);
      setLongitude(location.longitude);
    } else {
      setPostalCode(trimmed);
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

      const fullAddress = prediction.address
        ? `${prediction.name}, ${prediction.address}`
        : prediction.name;
      setAddressQuery(fullAddress);
      setHasSelectedAddress(true);
      setSelectedAddressName(prediction.name);
      setAddress(fullAddress);

      try {
        const details = await getPlaceDetails(prediction.placeId);
        if (details) {
          const components = details.addressComponents || [];
          const getComp = (types: string[]): string => {
            const c = components.find(comp => types.some(type => comp.types.includes(type)));
            return c?.longText || '';
          };
          const streetNumber = getComp(['street_number']);
          const route = getComp(['route']);
          const streetAddress = [streetNumber, route].filter(Boolean).join(' ');
          setSelectedAddressName(streetAddress || details.name);

          setAddress(details.address);
          setAddressQuery(details.address);
          setLatitude(details.latitude);
          setLongitude(details.longitude);

          if (details.city) setCity(details.city);
          if (details.province) setProvince(details.province);

          if (details.postalCode && isValidCanadianPostalCode(details.postalCode)) {
            try {
              const inCoverage = await checkPostalCodeCoverage(details.latitude, details.longitude);
              if (inCoverage) {
                setPostalCode(details.postalCode);
              }
            } catch {
              // Coverage check failed — keep existing postal code
            }
          }
        }
      } catch (error) {
        console.error('Failed to get place details:', error);
      }
    },
    [clearPredictions, getPlaceDetails]
  );

  // Handle clearing the selected address
  const handleClearAddress = useCallback(async () => {
    lightHaptic();
    setHasSelectedAddress(false);
    setSelectedAddressName('');
    setAddressQuery('');
    setAddress('');
    setCity('');
    setProvince('');
    clearPredictions();

    // Re-geocode the postal code to restore its coordinates
    if (postalCode) {
      const location = await geocode(postalCode);
      if (location) {
        setLatitude(location.latitude);
        setLongitude(location.longitude);
      } else {
        setLatitude(null);
        setLongitude(null);
      }
    } else {
      setLatitude(null);
      setLongitude(null);
    }
  }, [clearPredictions, postalCode, geocode]);

  // Main save handler
  const handleSave = async () => {
    if (isSaving) return;

    mediumHaptic();
    setIsSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsSaving(false);
        toast.error(t('onboarding.validation.playerNotFound'));
        return;
      }

      let finalLat = latitude;
      let finalLng = longitude;

      // If no address selected, geocode postal code for fresh coordinates
      if (!hasSelectedAddress && postalCode) {
        const location = await geocode(postalCode);
        if (location) {
          finalLat = location.latitude;
          finalLng = location.longitude;
        }
      }

      const { error: updateError } = await supabase
        .from('player')
        .update({
          address: address || null,
          city: city || null,
          province: province || null,
          postal_code: postalCode || null,
          latitude: finalLat,
          longitude: finalLng,
        })
        .eq('id', user.id);

      if (updateError) {
        Logger.error('Failed to update location', updateError as Error, { userId: user.id });
        setIsSaving(false);
        toast.error(t('onboarding.validation.failedToUpdateProfile'));
        return;
      }

      // Sync to local device storage
      if (postalCode && finalLat != null && finalLng != null) {
        await setHomeLocation({
          postalCode,
          country: 'CA',
          formattedAddress: address || postalCode,
          latitude: finalLat,
          longitude: finalLng,
        });
      }

      await refetchPlayer();
      toast.success(t('onboarding.successMessages.locationUpdated'));
      onSave?.();

      setTimeout(() => {
        SheetManager.hide('player-location');
      }, 500);
    } catch (error) {
      Logger.error('Unexpected error updating location', error as Error);
      setIsSaving(false);
      toast.error(t('onboarding.validation.unexpectedError'));
    }
  };

  const isFormValid = postalCode.length > 0 && isValidCanadianPostalCode(postalCode);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetContainer, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('profile.editSheets.locationTitle')}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Postal Code Badge — only shown when no address is selected */}
        {!hasSelectedAddress && (postalCode || isEditingPostalCode) && (
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
                    style={[styles.postalCodeActionButton, { backgroundColor: colors.primary }]}
                    onPress={handleSavePostalCode}
                    disabled={isGeocoding}
                  >
                    {isGeocoding ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <Ionicons name="checkmark" size={18} color={colors.primaryForeground} />
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
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                <View style={styles.postalCodeTextContainer}>
                  <Text size="sm" weight="semibold" color={colors.text}>
                    {t('onboarding.locationStep.savedPostalCode')}
                  </Text>
                  <Text size="lg" weight="bold" color={colors.primary}>
                    {postalCode}
                  </Text>
                </View>
                {!hasSelectedAddress && (
                  <TouchableOpacity
                    style={styles.postalCodeEditButton}
                    onPress={handleStartEditPostalCode}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="pencil" size={16} color={colors.primary} />
                    <Text size="xs" weight="medium" color={colors.primary}>
                      {t('onboarding.locationStep.editPostalCode')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* Address Section */}
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

          {hasSelectedAddress && address ? (
            <View
              style={[
                styles.selectedAddress,
                { backgroundColor: `${colors.primary}15`, borderColor: colors.primary },
              ]}
            >
              <View style={styles.selectedAddressContent}>
                <Ionicons name="location" size={20} color={colors.primary} />
                <View style={styles.selectedAddressText}>
                  <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
                    {selectedAddressName || address}
                  </Text>
                  <Text size="sm" color={colors.textMuted} numberOfLines={1}>
                    {[city, province, postalCode, 'Canada'].filter(Boolean).join(', ')}
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
                autoCapitalize="words"
              />

              {/* Loading state */}
              {isLoadingPredictions && (
                <View style={styles.loadingState}>
                  <ActivityIndicator size="small" color={colors.primary} />
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
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                      ]}
                      onPress={() => handleSelectPlace(place)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.placeItemIcon}>
                        <Ionicons name="location" size={18} color={colors.primary} />
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
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: colors.primary },
            (!isFormValid || isSaving) && { opacity: 0.6 },
          ]}
          onPress={handleSave}
          disabled={!isFormValid || isSaving}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text weight="semibold" style={{ color: colors.primaryForeground }}>
              {t('common.save')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

export default LocationActionSheet;

const styles = StyleSheet.create({
  sheetContainer: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
  },
  content: {
    padding: spacingPixels[4],
  },
  // Postal code badge styles
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
  postalCodeEditInput: {
    flex: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    fontSize: 16,
    fontWeight: '600',
    borderWidth: 1,
  },
  postalCodeActionButton: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.md,
    justifyContent: 'center',
    alignItems: 'center',
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
  // Address styles
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
  // Footer styles
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});
