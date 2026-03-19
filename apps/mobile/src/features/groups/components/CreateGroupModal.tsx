/**
 * CreateGroupModal
 * Modal for creating a new player group with optional cover image
 * Includes optional facility selection during creation
 *
 * Contains:
 * - CreateGroupForm: Standalone form component (used in ActionSheet and wizard)
 * - CreateGroupActionSheet: Thin ActionSheet wrapper
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  TextInput,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { Text, useToast } from '@rallia/shared-components';
import { neutral, radiusPixels, spacingPixels } from '@rallia/design-system';
import {
  useCreateGroup,
  useSports,
  useFacilitySearch,
  usePlayer,
  useNetworkLimits,
} from '@rallia/shared-hooks';
import { supabase, Logger } from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';

import { useRequireOnboarding, useThemeStyles, useTranslation } from '../../../hooks';
import { useSport } from '../../../context/SportContext';
import type { RootStackParamList } from '../../../navigation/types';
import { uploadImage } from '../../../services/imageUpload';
import { pickImageWithCropper } from '../../../utils/imagePicker';

// =============================================================================
// FORM COMPONENT
// =============================================================================

interface CreateGroupFormProps {
  onSuccess?: (groupId: string) => void;
  onCancel?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
}

export const CreateGroupForm: React.FC<CreateGroupFormProps> = ({
  onSuccess,
  onCancel,
  containerStyle,
}) => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const { selectedSport } = useSport();
  const { sports } = useSports();
  const { player } = usePlayer();
  const { limits } = useNetworkLimits();
  const toast = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Facility selection state
  const [selectedFacilities, setSelectedFacilities] = useState<FacilitySearchResult[]>([]);
  const [facilitySearchQuery, setFacilitySearchQuery] = useState('');
  const [showFacilitySearch, setShowFacilitySearch] = useState(false);

  const createGroupMutation = useCreateGroup();

  const playerId = player?.id;

  const { allSportIds, sportNames } = useMemo(() => {
    if (!sports || sports.length === 0) {
      return { allSportIds: [] as string[], sportNames: [] as string[] };
    }
    return {
      allSportIds: sports.map(s => s.id),
      sportNames: sports.map(s => s.name.charAt(0).toUpperCase() + s.name.slice(1)),
    };
  }, [sports]);

  const getSportLabels = useCallback(
    (facility: FacilitySearchResult): string[] => {
      const facilitySpIds = facility.sport_ids ?? [];
      const labels: string[] = [];
      for (let i = 0; i < allSportIds.length; i++) {
        if (facilitySpIds.includes(allSportIds[i])) {
          labels.push(sportNames[i]);
        }
      }
      return labels;
    },
    [allSportIds, sportNames]
  );

  const facilitySearchSportIds = useMemo(() => {
    return selectedSport ? [selectedSport.id] : (sports?.map(s => s.id) ?? []);
  }, [selectedSport, sports]);

  const { facilities: searchResults, isLoading: facilitySearchLoading } = useFacilitySearch({
    searchQuery: facilitySearchQuery,
    latitude: player?.latitude ?? undefined,
    longitude: player?.longitude ?? undefined,
    sportIds: facilitySearchSportIds,
    enabled: showFacilitySearch,
  });

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
    setCoverImage(null);
    setError(null);
    setSelectedFacilities([]);
    setFacilitySearchQuery('');
    setShowFacilitySearch(false);
  }, []);

  const handleAddFacility = useCallback(
    (facility: FacilitySearchResult) => {
      if (selectedFacilities.some(f => f.id === facility.id)) return;
      setSelectedFacilities(prev => [...prev, facility]);
    },
    [selectedFacilities]
  );

  const handleRemoveFacility = useCallback((facilityId: string) => {
    setSelectedFacilities(prev => prev.filter(f => f.id !== facilityId));
  }, []);

  const filteredSearchResults = useMemo(() => {
    return searchResults.filter(f => !selectedFacilities.some(sf => sf.id === f.id));
  }, [searchResults, selectedFacilities]);

  const handlePickImage = useCallback(async () => {
    try {
      const { uri, error } = await pickImageWithCropper({
        aspectRatio: [16, 9],
        quality: 0.8,
        source: 'gallery',
      });

      if (error) {
        Alert.alert(t('groups.permissionRequired'), t('groups.photoAccessRequired'));
        return;
      }

      if (uri) {
        setCoverImage(uri);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      Alert.alert(t('common.error'), t('groups.failedToPickImage'));
    }
  }, [t]);

  const handleRemoveImage = useCallback(() => {
    setCoverImage(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!guardAction()) return;

    if (!name.trim()) {
      setError(t('groups.nameRequired'));
      return;
    }

    if (name.trim().length < 2) {
      setError(t('groups.nameTooShort'));
      return;
    }

    if (name.trim().length > 50) {
      setError(t('groups.nameTooLong'));
      return;
    }

    setError(null);
    setIsLoading(true);

    let coverImageUrl: string | undefined;

    if (coverImage) {
      setIsUploadingImage(true);
      try {
        const { url, error: uploadError } = await uploadImage(coverImage, 'group-images');
        if (uploadError) {
          console.error('Error uploading image:', uploadError);
          Alert.alert(t('common.warning'), t('groups.failedToUploadImage'));
        } else if (url) {
          coverImageUrl = url;
        }
      } catch (err) {
        console.error('Error uploading image:', err);
      } finally {
        setIsUploadingImage(false);
      }
    }

    try {
      const newGroup = await createGroupMutation.mutateAsync({
        playerId: playerId!,
        input: {
          name: name.trim(),
          description: description.trim() || undefined,
          cover_image_url: coverImageUrl,
          sport_id: selectedSport?.id ?? null,
        },
      });

      if (selectedFacilities.length > 0) {
        const facilityInserts = selectedFacilities.map((facility, index) => ({
          network_id: newGroup.id,
          facility_id: facility.id,
          display_order: index + 1,
        }));

        const { error: facilityError } = await supabase
          .from('network_favorite_facility')
          .insert(facilityInserts);

        if (facilityError) {
          Logger.warn('Failed to add favorite facilities during group creation', {
            error: facilityError,
            groupId: newGroup.id,
          });
        }
      }

      toast.success(t('groups.success.created'));
      resetForm();
      onSuccess?.(newGroup.id);
    } catch (error) {
      Alert.alert(
        t('common.error'),
        error instanceof Error ? error.message : t('groups.errors.failedToCreate')
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    guardAction,
    name,
    selectedSport,
    description,
    coverImage,
    playerId,
    createGroupMutation,
    selectedFacilities,
    resetForm,
    onSuccess,
    toast,
    t,
  ]);

  const isSubmitting = isLoading || isUploadingImage;

  return (
    <View style={[styles.formContainer, containerStyle]}>
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Cover Image Picker */}
        <View style={styles.inputGroup}>
          <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
            {t('groups.groupImageOptional')}
          </Text>
          {coverImage ? (
            <View style={styles.imagePreviewContainer}>
              <Image source={{ uri: coverImage }} style={styles.imagePreview} />
              <TouchableOpacity
                style={[styles.removeImageButton, { backgroundColor: colors.cardBackground }]}
                onPress={handleRemoveImage}
              >
                <Ionicons name="close-outline" size={20} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.changeImageButton, { backgroundColor: colors.primary }]}
                onPress={() => void handlePickImage()}
              >
                <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
                <Text size="xs" weight="semibold" style={{ color: '#FFFFFF', marginLeft: 4 }}>
                  {t('common.change')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.imagePicker,
                {
                  backgroundColor: isDark ? neutral[800] : neutral[100],
                  borderColor: colors.border,
                },
              ]}
              onPress={() => void handlePickImage()}
            >
              <View style={[styles.imagePickerIcon, { backgroundColor: colors.cardBackground }]}>
                <Ionicons name="camera-outline" size={24} color={colors.primary} />
              </View>
              <Text size="sm" style={{ color: colors.textSecondary, marginTop: 8 }}>
                {t('groups.addCoverImage')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('groups.groupName')} *
            </Text>
            <Text size="xs" style={{ color: colors.textMuted }}>
              {name.length}/50
            </Text>
          </View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: error ? '#FF3B30' : colors.border,
              },
            ]}
            placeholder={t('groups.enterGroupName')}
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            maxLength={50}
          />
          {error && (
            <Text size="xs" style={{ color: '#FF3B30', marginTop: 4 }}>
              {error}
            </Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('groups.descriptionOptional')}
            </Text>
            <Text size="xs" style={{ color: colors.textMuted }}>
              {description.length}/200
            </Text>
          </View>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder={t('groups.descriptionPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={description}
            onChangeText={setDescription}
            maxLength={200}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Favorite Facilities Section (Optional) */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('groups.favoriteFacilitiesOptional')}
            </Text>
            {selectedFacilities.length > 0 && (
              <Text size="xs" style={{ color: colors.textMuted }}>
                {selectedFacilities.length}
              </Text>
            )}
          </View>

          {selectedFacilities.length > 0 && (
            <View style={styles.selectedFacilitiesContainer}>
              {selectedFacilities.map((facility, index) => (
                <View
                  key={facility.id}
                  style={[
                    styles.selectedFacilityBadge,
                    { backgroundColor: `${colors.primary}15`, borderColor: colors.primary },
                  ]}
                >
                  <View style={[styles.facilityOrderBadge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.facilityOrderText}>{index + 1}</Text>
                  </View>
                  <View style={styles.facilityBadgeTextContainer}>
                    <Text
                      style={[styles.facilityBadgeName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {facility.name}
                    </Text>
                    {facility.city && (
                      <Text
                        style={[styles.facilityBadgeCity, { color: colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {facility.city}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemoveFacility(facility.id)}
                    style={styles.facilityRemoveButton}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {!showFacilitySearch ? (
            <TouchableOpacity
              style={[
                styles.addFacilityButton,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
              ]}
              onPress={() => setShowFacilitySearch(true)}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text size="sm" style={{ color: colors.primary, marginLeft: 8 }}>
                {selectedFacilities.length > 0
                  ? t('groups.addAnotherFacility')
                  : t('groups.addFavoriteFacility')}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.facilitySearchContainer}>
              <View
                style={[
                  styles.facilitySearchInputWrapper,
                  { backgroundColor: colors.inputBackground, borderColor: colors.border },
                ]}
              >
                <Ionicons name="search" size={18} color={colors.textMuted} />
                <TextInput
                  style={[styles.facilitySearchInput, { color: colors.text }]}
                  placeholder={t('groups.searchFacilityToAdd')}
                  placeholderTextColor={colors.textMuted}
                  value={facilitySearchQuery}
                  onChangeText={setFacilitySearchQuery}
                  autoFocus
                />
                <TouchableOpacity
                  onPress={() => {
                    setShowFacilitySearch(false);
                    setFacilitySearchQuery('');
                  }}
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={[
                  styles.facilitySearchResults,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {facilitySearchLoading ? (
                  <View style={styles.facilitySearchLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : filteredSearchResults.length > 0 ? (
                  filteredSearchResults.slice(0, 8).map(facility => (
                    <TouchableOpacity
                      key={facility.id}
                      style={[
                        styles.facilitySearchResultItem,
                        { borderBottomColor: colors.border },
                      ]}
                      onPress={() => handleAddFacility(facility)}
                    >
                      <View style={styles.facilityResultInfo}>
                        <Text
                          style={[styles.facilityResultName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {facility.name}
                        </Text>
                        {(facility.address || facility.city) && (
                          <Text
                            style={[styles.facilityResultAddress, { color: colors.textMuted }]}
                            numberOfLines={1}
                          >
                            {[facility.address, facility.city].filter(Boolean).join(', ')}
                          </Text>
                        )}
                        {getSportLabels(facility).length > 0 && (
                          <View style={styles.facilitySportTagsRow}>
                            {getSportLabels(facility).map(label => (
                              <View
                                key={label}
                                style={[
                                  styles.facilitySportTag,
                                  { backgroundColor: `${colors.primary}20` },
                                ]}
                              >
                                <Text
                                  style={[styles.facilitySportTagText, { color: colors.primary }]}
                                >
                                  {label}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                      <Ionicons name="add-circle" size={24} color={colors.primary} />
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={styles.facilityNoResults}>
                    <Text style={[styles.facilityNoResultsText, { color: colors.textMuted }]}>
                      {t('groups.noFacilitiesFound')}
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>
          )}

          <Text size="xs" style={{ color: colors.textMuted, marginTop: 6 }}>
            {t('groups.favoriteFacilitiesHint')}
          </Text>
        </View>

        <View style={[styles.infoBox, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text size="sm" style={{ color: colors.textSecondary, flex: 1, marginLeft: 8 }}>
            {t('groups.createGroupHint', { maxMembers: limits?.max_group_members ?? 20 })}
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: colors.primary },
            isSubmitting && { opacity: 0.7 },
          ]}
          onPress={() => void handleSubmit()}
          disabled={isSubmitting || !name.trim()}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.buttonTextActive} />
          ) : (
            <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
              {t('groups.createGroup')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// ACTION SHEET WRAPPER
// =============================================================================

export function CreateGroupActionSheet({ payload }: SheetProps<'create-group'>) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const toast = useToast();

  const handleClose = useCallback(() => {
    void SheetManager.hide('create-group');
  }, []);

  const handleSuccess = useCallback(
    async (groupId: string) => {
      await SheetManager.hide('create-group');
      navigation.navigate('GroupDetail', { groupId });
    },
    [navigation]
  );

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        styles.sheetContainer,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('groups.createNewGroup')}
          </Text>
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <CreateGroupForm onSuccess={groupId => void handleSuccess(groupId)} onCancel={handleClose} />
    </ActionSheet>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  sheetContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    alignItems: 'center',
  },
  closeButton: {
    padding: 4,
    position: 'absolute',
    right: 16,
  },
  formContainer: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 20,
  },
  inputGroup: {
    gap: 0,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  imagePicker: {
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePickerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: 120,
    borderRadius: 12,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  changeImageButton: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 10,
  },
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
  // Facility styles
  selectedFacilitiesContainer: {
    gap: 8,
    marginBottom: 10,
  },
  selectedFacilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  facilityOrderBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  facilityOrderText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  facilityBadgeTextContainer: {
    flex: 1,
  },
  facilityBadgeName: {
    fontSize: 14,
    fontWeight: '500',
  },
  facilityBadgeCity: {
    fontSize: 12,
    marginTop: 2,
  },
  facilityRemoveButton: {
    padding: 4,
    marginLeft: 8,
  },
  addFacilityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  facilitySearchContainer: {
    gap: 8,
  },
  facilitySearchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  facilitySearchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  facilitySearchResults: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    maxHeight: 280,
  },
  facilitySearchLoading: {
    padding: 20,
    alignItems: 'center',
  },
  facilitySearchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
  },
  facilityResultInfo: {
    flex: 1,
  },
  facilityResultName: {
    fontSize: 14,
    fontWeight: '500',
  },
  facilityResultAddress: {
    fontSize: 12,
    marginTop: 2,
  },
  facilitySportTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  facilitySportTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  facilitySportTagText: {
    fontSize: 10,
    fontWeight: '500',
  },
  facilityNoResults: {
    padding: 20,
    alignItems: 'center',
  },
  facilityNoResultsText: {
    fontSize: 14,
  },
});

// Keep default export for backwards compatibility during migration
export default CreateGroupActionSheet;
