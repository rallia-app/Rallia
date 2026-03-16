/**
 * EditGroupModal
 * Modal for editing group name, description, and cover image
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
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { useUpdateGroup, type Group } from '@rallia/shared-hooks';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';

import { useThemeStyles, useAuth, useTranslation } from '../../../hooks';
import { uploadImage, replaceImage } from '../../../services/imageUpload';
import { pickImageWithCropper } from '../../../utils/imagePicker';

export function EditGroupActionSheet({ payload }: SheetProps<'edit-group'>) {
  const group = payload?.group as Group;
  const onSuccess = payload?.onSuccess;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t } = useTranslation();
  const playerId = session?.user?.id;
  const toast = useToast();

  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description || '');
  const [coverImage, setCoverImage] = useState<string | null>(group?.cover_image_url || null);
  const [newCoverImage, setNewCoverImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateGroupMutation = useUpdateGroup();

  // Reset form when group changes
  useEffect(() => {
    if (group) {
      setName(group.name);
      setDescription(group.description || '');
      setCoverImage(group.cover_image_url || null);
      setNewCoverImage(null);
      setError(null);
    }
  }, [group]);

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
      await updateGroupMutation.mutateAsync({
        groupId: group.id,
        playerId,
        input: {
          name: name.trim(),
          description: description.trim() || undefined,
          ...(coverImageUrl !== undefined && { cover_image_url: coverImageUrl || undefined }),
        },
      });

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
    playerId,
    updateGroupMutation,
    onSuccess,
    newCoverImage,
    coverImage,
    toast,
    t,
  ]);

  const hasChanges =
    name !== group.name ||
    description !== (group.description || '') ||
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
});
