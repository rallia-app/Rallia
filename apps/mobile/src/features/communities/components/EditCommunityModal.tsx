/**
 * EditCommunityModal
 * Modal for editing community name, description, cover image, and visibility
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  Switch,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { useUpdateCommunity, type Community } from '@rallia/shared-hooks';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';

import { useThemeStyles, useAuth, useTranslation } from '../../../hooks';
import { uploadImage, replaceImage } from '../../../services/imageUpload';
import { pickImageWithCropper } from '../../../utils/imagePicker';

export function EditCommunityActionSheet({ payload }: SheetProps<'edit-community'>) {
  const community = payload?.community as Community;
  const onSuccess = payload?.onSuccess;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const toast = useToast();

  const [name, setName] = useState(community?.name ?? '');
  const [description, setDescription] = useState(community?.description || '');
  const [isPublic, setIsPublic] = useState(community?.is_public ?? true);
  const [coverImage, setCoverImage] = useState<string | null>(community?.cover_image_url || null);
  const [newCoverImage, setNewCoverImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateCommunityMutation = useUpdateCommunity();

  // Reset form when community changes
  useEffect(() => {
    if (community) {
      setName(community.name);
      setDescription(community.description || '');
      setIsPublic(community.is_public ?? true);
      setCoverImage(community.cover_image_url || null);
      setNewCoverImage(null);
      setError(null);
    }
  }, [community]);

  const handleClose = useCallback(() => {
    setError(null);
    setNewCoverImage(null);
    void SheetManager.hide('edit-community');
  }, []);

  const handlePickImage = useCallback(async () => {
    try {
      const { uri, error } = await pickImageWithCropper({
        aspectRatio: [16, 9],
        quality: 0.8,
        source: 'gallery',
      });

      if (error) {
        Alert.alert(t('community.permissionRequired'), t('community.photoAccessRequiredEdit'));
        return;
      }

      if (uri) {
        setNewCoverImage(uri);
      }
    } catch (err) {
      console.error('[EditCommunityModal] Error picking image:', err);
      Alert.alert(t('common.error'), t('community.failedToPickImage'));
    }
  }, [t]);

  const handleRemoveImage = useCallback(() => {
    setCoverImage(null);
    setNewCoverImage(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!playerId) return;

    if (!name.trim()) {
      setError(t('community.nameRequired'));
      return;
    }

    if (name.trim().length < 2) {
      setError(t('community.nameTooShort'));
      return;
    }

    if (name.trim().length > 50) {
      setError(t('community.nameTooLong'));
      return;
    }

    setError(null);

    let coverImageUrl: string | null | undefined = undefined;

    // Handle image upload if there's a new image
    if (newCoverImage) {
      setIsUploadingImage(true);
      try {
        if (community.cover_image_url) {
          // Replace existing image
          const { url, error: uploadError } = await replaceImage(
            newCoverImage,
            community.cover_image_url,
            'group-images' // Communities share the same bucket as groups
          );
          if (uploadError) {
            console.error('[EditCommunityModal] Error replacing image:', uploadError);
            Alert.alert(t('common.warning'), t('community.failedToUpdateImage'));
          } else {
            coverImageUrl = url;
          }
        } else {
          // Upload new image
          const { url, error: uploadError } = await uploadImage(newCoverImage, 'group-images');
          if (uploadError) {
            console.error('[EditCommunityModal] Error uploading image:', uploadError);
            Alert.alert(t('common.warning'), t('community.failedToUploadImage'));
          } else if (url) {
            coverImageUrl = url;
          }
        }
      } catch (err) {
        console.error('[EditCommunityModal] Error uploading image:', err);
      } finally {
        setIsUploadingImage(false);
      }
    } else if (coverImage === null && community.cover_image_url) {
      // User removed the image
      coverImageUrl = null;
    }

    try {
      await updateCommunityMutation.mutateAsync({
        communityId: community.id,
        playerId,
        input: {
          name: name.trim(),
          description: description.trim() || undefined,
          is_public: isPublic,
          ...(coverImageUrl !== undefined && { cover_image_url: coverImageUrl || undefined }),
        },
      });

      // Close modal first
      await SheetManager.hide('edit-community');
      // Show success toast
      toast.success(t('community.success.updated'));
      onSuccess?.();
    } catch (err) {
      console.error('[EditCommunityModal] Error updating community:', err);
      Alert.alert(
        t('common.error'),
        err instanceof Error ? err.message : t('community.failedToUpdateCommunity')
      );
    }
  }, [
    name,
    description,
    isPublic,
    community.id,
    community.cover_image_url,
    playerId,
    updateCommunityMutation,
    onSuccess,
    newCoverImage,
    coverImage,
    toast,
    t,
  ]);

  const hasChanges =
    name !== community.name ||
    description !== (community.description || '') ||
    isPublic !== (community.is_public ?? true) ||
    newCoverImage !== null ||
    (coverImage === null && community.cover_image_url !== null);

  const displayImage = newCoverImage || coverImage;
  const isSubmitting = updateCommunityMutation.isPending || isUploadingImage;

  if (!community) return null;

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
            {t('community.editCommunity')}
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
              {t('community.communityImageLabel')}
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
                  {t('community.addCoverImage')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Community Name */}
          <View style={styles.inputGroup}>
            <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
              {t('community.communityName')} *
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
              placeholder={t('community.enterCommunityName')}
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

          {/* Description */}
          <View style={styles.inputGroup}>
            <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
              {t('community.descriptionOptional')}
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
              placeholder={t('community.descriptionPlaceholder')}
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

          {/* Visibility Toggle */}
          <View
            style={[
              styles.visibilityToggle,
              { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7', borderColor: colors.border },
            ]}
          >
            <View style={styles.visibilityInfo}>
              <View
                style={[
                  styles.visibilityIcon,
                  { backgroundColor: isPublic ? '#E8F5E9' : '#FFF3E0' },
                ]}
              >
                <Ionicons
                  name={isPublic ? 'globe-outline' : 'lock-closed-outline'}
                  size={20}
                  color={isPublic ? '#2E7D32' : '#EF6C00'}
                />
              </View>
              <View style={styles.visibilityText}>
                <Text weight="semibold" style={{ color: colors.text }}>
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
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
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
export const EditCommunityModal = EditCommunityActionSheet;

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
  visibilityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  visibilityInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  visibilityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  visibilityText: {
    flex: 1,
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
});
