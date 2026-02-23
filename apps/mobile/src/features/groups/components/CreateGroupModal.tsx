/**
 * CreateGroupModal
 * Modal for creating a new player group with optional cover image
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  ScrollView,
  TextInput,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, NavigationProp } from '@react-navigation/native';

import { Text } from '@rallia/shared-components';
import { useRequireOnboarding, useThemeStyles, useTranslation } from '../../../hooks';
import { uploadImage } from '../../../services/imageUpload';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { useCreateGroup } from '@rallia/shared-hooks';
import type { RootStackParamList } from '../../../navigation/types';

export function CreateGroupActionSheet({ payload }: SheetProps<'create-group'>) {
  const playerId = payload?.playerId;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createGroupMutation = useCreateGroup();

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
    setCoverImage(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    SheetManager.hide('create-group');
  }, [resetForm]);

  const handlePickImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('groups.permissionRequired'), t('groups.photoAccessRequired'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setCoverImage(result.assets[0].uri);
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

    // Upload image if selected
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
        },
      });
      resetForm();
      // Hide modal first, then navigate
      await SheetManager.hide('create-group');
      // Navigate to the new group after modal is dismissed
      navigation.navigate('GroupDetail', { groupId: newGroup.id });
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
    description,
    coverImage,
    playerId,
    createGroupMutation,
    resetForm,
    navigation,
    t,
  ]);

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
            {t('groups.createNewGroup')}
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
                onPress={handlePickImage}
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
              onPress={handlePickImage}
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

        <View style={[styles.infoBox, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text size="sm" style={{ color: colors.textSecondary, flex: 1, marginLeft: 8 }}>
            {t('groups.createGroupHint')}
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
          onPress={handleSubmit}
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
});

// Keep default export for backwards compatibility during migration
export default CreateGroupActionSheet;
