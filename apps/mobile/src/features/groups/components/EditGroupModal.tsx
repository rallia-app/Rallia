/**
 * EditGroupModal
 * Modal for editing group name, description, and cover image
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { useUpdateGroup, useSports, type Group } from '@rallia/shared-hooks';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { supabase, Logger } from '@rallia/shared-services';

import { useThemeStyles, useAuth, useTranslation } from '../../../hooks';
import { uploadImage, replaceImage } from '../../../services/imageUpload';
import { pickImageWithCropper } from '../../../utils/imagePicker';

type SportOption = 'both' | 'tennis' | 'pickleball';

export function EditGroupActionSheet({ payload }: SheetProps<'edit-group'>) {
  const group = payload?.group as Group;
  const onSuccess = payload?.onSuccess;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t } = useTranslation();
  const playerId = session?.user?.id;
  const { sports } = useSports();
  const toast = useToast();

  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description || '');
  const [coverImage, setCoverImage] = useState<string | null>(group?.cover_image_url || null);
  const [newCoverImage, setNewCoverImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSportOption, setSelectedSportOption] = useState<SportOption>('both');

  const updateGroupMutation = useUpdateGroup();

  // Get sport IDs from the sports list
  const sportIds = useMemo(() => {
    const tennis = sports.find(s => s.name.toLowerCase() === 'tennis');
    const pickleball = sports.find(s => s.name.toLowerCase() === 'pickleball');
    return {
      tennis: tennis?.id || null,
      pickleball: pickleball?.id || null,
    };
  }, [sports]);

  // Get the sport_id based on selection
  const getSportId = useCallback((): string | null => {
    switch (selectedSportOption) {
      case 'tennis':
        return sportIds.tennis;
      case 'pickleball':
        return sportIds.pickleball;
      default:
        return null; // both sports
    }
  }, [selectedSportOption, sportIds]);

  // Get the sport option from sport_id
  const getSportOptionFromId = useCallback(
    (sportId: string | null): SportOption => {
      if (!sportId) return 'both';
      if (sportId === sportIds.tennis) return 'tennis';
      if (sportId === sportIds.pickleball) return 'pickleball';
      return 'both';
    },
    [sportIds]
  );

  /**
   * Cleanup favorite facilities when sport changes.
   * - If changing to "both" (null) -> no cleanup (expanding scope)
   * - If changing from one sport to another or from "both" to specific ->
   *   remove facilities that don't support the new sport
   */
  const cleanupIncompatibleFacilities = useCallback(
    async (oldSportId: string | null, newSportId: string | null) => {
      // If new sport is "both" (null), no cleanup needed - we're expanding, not restricting
      if (newSportId === null) {
        return;
      }

      // If sport didn't actually change, no cleanup needed
      if (oldSportId === newSportId) {
        return;
      }

      try {
        // Get all favorite facilities for this group with their sport associations
        const { data: favorites, error: fetchError } = await supabase
          .from('network_favorite_facility')
          .select(
            `
            id,
            facility_id,
            facility:facility_id (
              id,
              facility_sport (
                sport_id
              )
            )
          `
          )
          .eq('network_id', group.id);

        if (fetchError) {
          Logger.error('Error fetching favorite facilities for cleanup:', fetchError);
          return;
        }

        if (!favorites || favorites.length === 0) {
          return;
        }

        // Find facilities that don't support the new sport
        const facilitiesToRemove = favorites.filter(fav => {
          // Supabase returns nested joins as objects
          const facility = fav.facility as unknown as {
            id: string;
            facility_sport: { sport_id: string }[];
          } | null;
          if (!facility) return true; // Remove if facility data is missing
          const facilitySportIds = facility.facility_sport?.map(fs => fs.sport_id) ?? [];
          // Keep if facility supports the new sport
          return !facilitySportIds.includes(newSportId);
        });

        if (facilitiesToRemove.length === 0) {
          return;
        }

        // Remove incompatible facilities
        const idsToRemove = facilitiesToRemove.map(f => f.id as string);
        const { error: deleteError } = await supabase
          .from('network_favorite_facility')
          .delete()
          .in('id', idsToRemove);

        if (deleteError) {
          Logger.error('Error removing incompatible facilities:', deleteError);
        } else {
          Logger.info(
            `Removed ${idsToRemove.length} incompatible favorite facilities after sport change`
          );
        }
      } catch (err) {
        Logger.error(
          'Error in cleanupIncompatibleFacilities:',
          err instanceof Error ? err : undefined
        );
      }
    },
    [group.id]
  );

  // Reset form when group changes
  useEffect(() => {
    if (group) {
      setName(group.name);
      setDescription(group.description || '');
      setCoverImage(group.cover_image_url || null);
      setNewCoverImage(null);
      setError(null);
      setSelectedSportOption(getSportOptionFromId(group.sport_id));
    }
  }, [group, getSportOptionFromId]);

  const handleClose = useCallback(() => {
    setError(null);
    setNewCoverImage(null);
    void SheetManager.hide('edit-group');
  }, []);

  const handlePickImage = useCallback(async () => {
    try {
      const { uri, error } = await pickImageWithCropper({
        aspectRatio: [16, 9],
        quality: 0.8,
        source: 'gallery',
      });

      if (error) {
        Alert.alert(t('groups.permissionRequired'), t('groups.photoAccessRequiredEdit'));
        return;
      }

      if (uri) {
        setNewCoverImage(uri);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      Alert.alert(t('common.error'), t('groups.failedToPickImage'));
    }
  }, [t]);

  const handleRemoveImage = useCallback(() => {
    setCoverImage(null);
    setNewCoverImage(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!playerId) return;

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

    let coverImageUrl: string | null | undefined = undefined;

    // Handle image upload if there's a new image
    if (newCoverImage) {
      setIsUploadingImage(true);
      try {
        if (group.cover_image_url) {
          // Replace existing image
          const { url, error: uploadError } = await replaceImage(
            newCoverImage,
            group.cover_image_url,
            'group-images'
          );
          if (uploadError) {
            console.error('Error replacing image:', uploadError);
            Alert.alert(t('common.warning'), t('groups.failedToUpdateImage'));
          } else {
            coverImageUrl = url;
          }
        } else {
          // Upload new image
          const { url, error: uploadError } = await uploadImage(newCoverImage, 'group-images');
          if (uploadError) {
            console.error('Error uploading image:', uploadError);
            Alert.alert(t('common.warning'), t('groups.failedToUploadImage'));
          } else if (url) {
            coverImageUrl = url;
          }
        }
      } catch (err) {
        console.error('Error uploading image:', err);
      } finally {
        setIsUploadingImage(false);
      }
    } else if (coverImage === null && group.cover_image_url) {
      // User removed the image
      coverImageUrl = null;
    }

    try {
      const newSportId = getSportId();
      const oldSportId = group.sport_id;

      await updateGroupMutation.mutateAsync({
        groupId: group.id,
        playerId,
        input: {
          name: name.trim(),
          description: description.trim() || undefined,
          sport_id: newSportId,
          ...(coverImageUrl !== undefined && { cover_image_url: coverImageUrl || undefined }),
        },
      });

      // Cleanup incompatible facilities if sport changed
      await cleanupIncompatibleFacilities(oldSportId, newSportId);

      // Close modal first
      await SheetManager.hide('edit-group');
      // Show success toast
      toast.success(t('groups.success.updated'));
      onSuccess?.();
    } catch (err) {
      Alert.alert(
        t('common.error'),
        err instanceof Error ? err.message : t('groups.failedToUpdateGroup')
      );
    }
  }, [
    name,
    description,
    group.id,
    group.cover_image_url,
    group.sport_id,
    playerId,
    updateGroupMutation,
    onSuccess,
    newCoverImage,
    coverImage,
    getSportId,
    cleanupIncompatibleFacilities,
    toast,
    t,
  ]);

  const hasChanges =
    name !== group.name ||
    description !== (group.description || '') ||
    getSportId() !== group.sport_id ||
    newCoverImage !== null ||
    (coverImage === null && group.cover_image_url !== null);

  const displayImage = newCoverImage || coverImage;
  const isSubmitting = updateGroupMutation.isPending || isUploadingImage;

  if (!group) return null;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('groups.editGroup')}
          </Text>
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
          {/* Cover Image Picker */}
          <View style={styles.inputGroup}>
            <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
              {t('groups.groupImage')}
            </Text>
            {displayImage ? (
              <View style={styles.imagePreviewContainer}>
                <Image source={{ uri: displayImage }} style={styles.imagePreview} />
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
                  {t('groups.addCoverImage')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.inputGroup}>
            <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
              {t('groups.groupName')} *
            </Text>
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
            <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
              {t('groups.descriptionOptional')}
            </Text>
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
            <Text size="xs" style={{ color: colors.textMuted, marginTop: 4, textAlign: 'right' }}>
              {description.length}/200
            </Text>
          </View>

          {/* Sport Selection */}
          <View style={styles.inputGroup}>
            <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
              {t('groups.sportSelection')}
            </Text>
            <View style={styles.sportOptions}>
              {/* Both Sports Option */}
              <TouchableOpacity
                style={[
                  styles.sportOption,
                  {
                    backgroundColor:
                      selectedSportOption === 'both'
                        ? isDark
                          ? primary[900]
                          : primary[100]
                        : colors.inputBackground,
                    borderColor: selectedSportOption === 'both' ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedSportOption('both')}
              >
                <View style={styles.sportOptionIcons}>
                  <MaterialCommunityIcons
                    name="tennis"
                    size={18}
                    color={selectedSportOption === 'both' ? colors.primary : colors.textMuted}
                  />
                  <Text style={{ color: colors.textMuted, marginHorizontal: 2 }}>+</Text>
                  <MaterialCommunityIcons
                    name="badminton"
                    size={18}
                    color={selectedSportOption === 'both' ? colors.primary : colors.textMuted}
                  />
                </View>
                <Text
                  size="xs"
                  weight={selectedSportOption === 'both' ? 'semibold' : 'regular'}
                  style={{
                    color: selectedSportOption === 'both' ? colors.primary : colors.text,
                    marginTop: 4,
                  }}
                >
                  {t('groups.sportBoth')}
                </Text>
                {selectedSportOption === 'both' && (
                  <View style={[styles.sportOptionCheck, { backgroundColor: colors.primary }]}>
                    <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>

              {/* Tennis Only Option */}
              <TouchableOpacity
                style={[
                  styles.sportOption,
                  {
                    backgroundColor:
                      selectedSportOption === 'tennis'
                        ? isDark
                          ? primary[900]
                          : primary[100]
                        : colors.inputBackground,
                    borderColor: selectedSportOption === 'tennis' ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedSportOption('tennis')}
              >
                <MaterialCommunityIcons
                  name="tennis"
                  size={24}
                  color={selectedSportOption === 'tennis' ? colors.primary : colors.textMuted}
                />
                <Text
                  size="xs"
                  weight={selectedSportOption === 'tennis' ? 'semibold' : 'regular'}
                  style={{
                    color: selectedSportOption === 'tennis' ? colors.primary : colors.text,
                    marginTop: 4,
                  }}
                >
                  {t('groups.sportTennis')}
                </Text>
                {selectedSportOption === 'tennis' && (
                  <View style={[styles.sportOptionCheck, { backgroundColor: colors.primary }]}>
                    <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>

              {/* Pickleball Only Option */}
              <TouchableOpacity
                style={[
                  styles.sportOption,
                  {
                    backgroundColor:
                      selectedSportOption === 'pickleball'
                        ? isDark
                          ? primary[900]
                          : primary[100]
                        : colors.inputBackground,
                    borderColor:
                      selectedSportOption === 'pickleball' ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedSportOption('pickleball')}
              >
                <MaterialCommunityIcons
                  name="badminton"
                  size={24}
                  color={selectedSportOption === 'pickleball' ? colors.primary : colors.textMuted}
                />
                <Text
                  size="xs"
                  weight={selectedSportOption === 'pickleball' ? 'semibold' : 'regular'}
                  style={{
                    color: selectedSportOption === 'pickleball' ? colors.primary : colors.text,
                    marginTop: 4,
                  }}
                >
                  {t('groups.sportPickleball')}
                </Text>
                {selectedSportOption === 'pickleball' && (
                  <View style={[styles.sportOptionCheck, { backgroundColor: colors.primary }]}>
                    <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            </View>
            <Text size="xs" style={{ color: colors.textMuted, marginTop: 6 }}>
              {t('groups.sportSelectionHint')}
            </Text>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.cancelButton, { borderColor: colors.border }]}
            onPress={handleClose}
            disabled={isSubmitting}
          >
            <Text style={{ color: colors.text }}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (!hasChanges || isSubmitting) && { opacity: 0.7 },
            ]}
            onPress={() => void handleSubmit()}
            disabled={!hasChanges || isSubmitting || !name.trim()}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.buttonTextActive} />
            ) : (
              <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
                {t('common.saveChanges')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const EditGroupModal = EditGroupActionSheet;

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
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: 4,
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
  footer: {
    flexDirection: 'row',
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
    gap: spacingPixels[3],
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  sportOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  sportOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    position: 'relative',
    minHeight: 70,
  },
  sportOptionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sportOptionCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
