/**
 * CreateCommunityModal
 * Modal for creating a new community with visibility toggle
 * Includes optional facility selection during creation
 */

import { useState, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
  Switch,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { Text, useToast } from '@rallia/shared-components';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { useCreateCommunity, useSports, useFacilitySearch, usePlayer } from '@rallia/shared-hooks';
import { supabase, Logger } from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';

import { useRequireOnboarding, useThemeStyles, useTranslation } from '../../../hooks';
import { useSport } from '../../../context';
import { CommunityStackParamList } from '../../../navigation/types';
import { uploadImage } from '../../../services/imageUpload';
import { pickImageWithCropper } from '../../../utils/imagePicker';

export function CreateCommunityActionSheet({ payload }: SheetProps<'create-community'>) {
  const playerId = payload?.playerId;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const navigation = useNavigation<NavigationProp<CommunityStackParamList>>();
  const toast = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isLoading, _setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Facility selection state
  const [selectedFacilities, setSelectedFacilities] = useState<FacilitySearchResult[]>([]);
  const [facilitySearchQuery, setFacilitySearchQuery] = useState('');
  const [showFacilitySearch, setShowFacilitySearch] = useState(false);

  const createCommunityMutation = useCreateCommunity();
  const { sports } = useSports();
  const { player } = usePlayer();
  const { selectedSport } = useSport();

  // Get all sport IDs and names for displaying sport tags on facilities
  const { allSportIds, sportNames } = useMemo(() => {
    if (!sports || sports.length === 0) {
      return { allSportIds: [], sportNames: [] };
    }
    return {
      allSportIds: sports.map(s => s.id),
      sportNames: sports.map(s => s.name.charAt(0).toUpperCase() + s.name.slice(1)),
    };
  }, [sports]);

  // Helper to get sport labels for a facility
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

  // Get sport IDs for facility search based on current sport context
  const facilitySearchSportIds = useMemo(() => {
    return selectedSport ? [selectedSport.id] : (sports?.map(s => s.id) ?? []);
  }, [selectedSport, sports]);

  // Use facility search hook - enabled when search is open (shows all nearby by default)
  const { facilities: searchResults, isLoading: facilitySearchLoading } = useFacilitySearch({
    searchQuery: facilitySearchQuery,
    latitude: player?.latitude ?? undefined,
    longitude: player?.longitude ?? undefined,
    sportIds: facilitySearchSportIds,
    enabled: showFacilitySearch,
  });

  const handleCreateCommunity = useCallback(
    async (
      name: string,
      description?: string,
      coverImageUrl?: string,
      isPublic: boolean = true,
      sportId: string | null = null,
      facilities: FacilitySearchResult[] = []
    ) => {
      if (!guardAction()) return;

      try {
        const newCommunity = await createCommunityMutation.mutateAsync({
          playerId: playerId!,
          input: {
            name,
            description,
            cover_image_url: coverImageUrl,
            is_public: isPublic,
            sport_id: sportId,
          },
        });

        // Add selected facilities as favorites
        if (facilities.length > 0) {
          const facilityInserts = facilities.map((facility, index) => ({
            network_id: newCommunity.id,
            facility_id: facility.id,
            display_order: index + 1,
          }));

          const { error: facilityError } = await supabase
            .from('network_favorite_facility')
            .insert(facilityInserts);

          if (facilityError) {
            Logger.warn('Failed to add favorite facilities during community creation', {
              error: facilityError,
              communityId: newCommunity.id,
            });
            // Don't fail creation, just log the warning
          }
        }

        // Close modal first
        await SheetManager.hide('create-community');
        // Show success toast
        toast.success(t('community.success.created'));
        // Navigate to the new community
        navigation.navigate('CommunityDetail', { communityId: newCommunity.id });
      } catch (error) {
        Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create community');
      }
    },
    [guardAction, playerId, createCommunityMutation, navigation, toast, t]
  );

  const handlePickImage = useCallback(async () => {
    try {
      const { uri, error } = await pickImageWithCropper({
        aspectRatio: [16, 9],
        quality: 0.8,
        source: 'gallery',
      });

      if (error) {
        Alert.alert(t('community.permissionRequired'), t('community.photoAccessRequired'));
        return;
      }

      if (uri) {
        setCoverImage(uri);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      Alert.alert(t('common.error'), t('community.failedToPickImage'));
    }
  }, [t]);

  const handleRemoveImage = useCallback(() => {
    setCoverImage(null);
  }, []);

  // Facility selection handlers
  const handleAddFacility = useCallback(
    (facility: FacilitySearchResult) => {
      if (selectedFacilities.some(f => f.id === facility.id)) return;
      setSelectedFacilities(prev => [...prev, facility]);
      setFacilitySearchQuery('');
      setShowFacilitySearch(false);
    },
    [selectedFacilities]
  );

  const handleRemoveFacility = useCallback((facilityId: string) => {
    setSelectedFacilities(prev => prev.filter(f => f.id !== facilityId));
  }, []);

  // Filter search results to exclude already selected facilities
  const filteredSearchResults = useMemo(() => {
    return searchResults.filter(f => !selectedFacilities.some(sf => sf.id === f.id));
  }, [searchResults, selectedFacilities]);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      setError(t('community.nameRequired'));
      return;
    }

    if (name.trim().length < 2) {
      setError(t('community.nameTooShort'));
      return;
    }

    if (name.trim().length > 100) {
      setError(t('community.nameTooLong'));
      return;
    }

    setError(null);

    let coverImageUrl: string | undefined;

    if (coverImage) {
      setIsUploadingImage(true);
      try {
        // Use 'group-images' bucket as it's shared for network cover images
        const { url, error: uploadError } = await uploadImage(coverImage, 'group-images');
        if (uploadError) {
          console.error('Error uploading image:', uploadError);
          Alert.alert(t('common.warning'), t('community.failedToUploadImage'));
        } else if (url) {
          coverImageUrl = url;
        }
      } catch (err) {
        console.error('Error uploading image:', err);
      } finally {
        setIsUploadingImage(false);
      }
    }

    await handleCreateCommunity(
      name.trim(),
      description.trim() || undefined,
      coverImageUrl,
      isPublic,
      selectedSport?.id ?? null,
      selectedFacilities
    );
    setName('');
    setDescription('');
    setCoverImage(null);
    setIsPublic(true);
    setSelectedFacilities([]);
    setFacilitySearchQuery('');
    setShowFacilitySearch(false);
  }, [
    name,
    description,
    coverImage,
    isPublic,
    t,
    selectedSport,
    selectedFacilities,
    handleCreateCommunity,
  ]);

  const handleClose = useCallback(() => {
    setName('');
    setDescription('');
    setCoverImage(null);
    setIsPublic(true);
    setSelectedFacilities([]);
    setFacilitySearchQuery('');
    setShowFacilitySearch(false);
    setError(null);
    void SheetManager.hide('create-community');
  }, []);

  const isSubmitting = isLoading || isUploadingImage;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        styles.container,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('community.createCommunity')}
          </Text>
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inputGroup}>
          <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
            {t('community.communityImage')}
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
                  backgroundColor: isDark ? primary[900] : primary[100],
                  borderColor: colors.border,
                },
              ]}
              onPress={() => void handlePickImage()}
            >
              <View style={[styles.imagePickerIcon, { backgroundColor: colors.cardBackground }]}>
                <Ionicons name="camera-outline" size={24} color={colors.primary} />
              </View>
              <Text size="sm" style={{ color: colors.textSecondary, marginTop: 8 }}>
                {t('community.addCoverImage')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('community.communityName')} *
            </Text>
            <Text size="xs" style={{ color: colors.textMuted }}>
              {name.length}/100
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
            placeholder={t('community.enterCommunityName')}
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            maxLength={100}
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
              {t('community.descriptionOptional')}
            </Text>
            <Text size="xs" style={{ color: colors.textMuted }}>
              {description.length}/500
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
            placeholder={t('community.descriptionPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <View
          style={[styles.visibilityToggle, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}
        >
          <View style={styles.visibilityLeft}>
            <View
              style={[
                styles.visibilityIcon,
                { backgroundColor: isPublic ? '#34C75920' : '#FF950020' },
              ]}
            >
              <Ionicons
                name={isPublic ? 'globe-outline' : 'lock-closed-outline'}
                size={24}
                color={isPublic ? '#34C759' : '#FF9500'}
              />
            </View>
            <View style={styles.visibilityText}>
              <Text weight="semibold" size="sm" style={{ color: colors.text }}>
                {isPublic ? t('community.publicCommunity') : t('community.privateCommunity')}
              </Text>
              <Text size="xs" style={{ color: colors.textSecondary, marginTop: 2 }}>
                {isPublic ? t('community.publicDescription') : t('community.privateDescription')}
              </Text>
            </View>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: '#767577', true: colors.primary + '80' }}
            thumbColor={isPublic ? colors.primary : '#f4f3f4'}
          />
        </View>

        {/* Favorite Facilities Section (Optional) */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('community.favoriteFacilitiesOptional')}
            </Text>
            {selectedFacilities.length > 0 && (
              <Text size="xs" style={{ color: colors.textMuted }}>
                {selectedFacilities.length}
              </Text>
            )}
          </View>

          {/* Selected facilities */}
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

          {/* Add facility search */}
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
                  ? t('community.addAnotherFacility')
                  : t('community.addFavoriteFacility')}
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
                  placeholder={t('community.searchFacilityToAdd')}
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

              {/* Search results - show immediately, filter as user types */}
              <View
                style={[
                  styles.facilitySearchResults,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
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
                        {/* Sport tags */}
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
                      {t('community.noFacilitiesFound')}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          <Text size="xs" style={{ color: colors.textMuted, marginTop: 6 }}>
            {t('community.favoriteFacilitiesHint')}
          </Text>
        </View>

        <View style={[styles.infoBox, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
          <Ionicons name="information-circle" size={20} color={colors.primary} />
          <Text size="sm" style={{ color: colors.textSecondary, flex: 1, marginLeft: 8 }}>
            {t('community.createInfo')}
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
              {t('common.confirm')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

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
  container: {
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
  scrollContent: {
    flex: 1,
  },
  content: {
    flex: 0,
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
  visibilityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
  },
  visibilityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  visibilityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  visibilityText: {
    flex: 1,
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
    paddingBottom: spacingPixels[4],
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  // Facility selection styles
  selectedFacilitiesContainer: {
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  selectedFacilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[2],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  facilityOrderBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[2],
  },
  facilityOrderText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  facilityBadgeTextContainer: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  facilityBadgeName: {
    fontSize: 13,
    fontWeight: '500',
  },
  facilityBadgeCity: {
    fontSize: 11,
    marginTop: 1,
  },
  facilityRemoveButton: {
    padding: 2,
  },
  addFacilityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  facilitySearchContainer: {
    gap: spacingPixels[2],
  },
  facilitySearchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  facilitySearchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  facilitySearchResults: {
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    maxHeight: 280,
    overflow: 'hidden',
  },
  facilitySearchLoading: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
  facilitySearchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderBottomWidth: 1,
  },
  facilityResultInfo: {
    flex: 1,
    marginRight: spacingPixels[2],
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
    gap: spacingPixels[1],
    marginTop: spacingPixels[1],
  },
  facilitySportTag: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.sm,
  },
  facilitySportTagText: {
    fontSize: 10,
    fontWeight: '500',
  },
  facilityNoResults: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
  facilityNoResultsText: {
    fontSize: 13,
  },
});
