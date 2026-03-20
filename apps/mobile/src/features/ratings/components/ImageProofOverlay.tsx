import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, Button, useToast } from '@rallia/shared-components';
import { useThemeStyles, useTranslation, useImagePicker } from '../../../hooks';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import {
  uploadRatingProofFile,
  validateProofFile,
  getMaxFileSizes,
} from '../../../services/ratingProofUpload';
import { Logger, supabase } from '@rallia/shared-services';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import type { ProofFormProps } from './AddRatingProofOverlay';

interface ImageProofOverlayProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  playerRatingScoreId: string;
}

export function ImageProofForm({
  onBack,
  onClose,
  onSuccess,
  playerRatingScoreId,
}: ProofFormProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const [selectedImage, setSelectedImage] = useState<{
    uri: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const { pickFromCamera, pickFromGallery } = useImagePicker();

  const resetForm = () => {
    setSelectedImage(null);
    setTitle('');
    setDescription('');
    setUploadProgress(0);
  };

  const handleImageSelected = (
    uri: string,
    fileName: string = 'image.jpg',
    fileSize: number = 0,
    mimeType: string = 'image/jpeg'
  ) => {
    const validation = validateProofFile(fileName, fileSize, 'image');
    if (!validation.valid) {
      toast.error(validation.error || t('profile.ratingProofs.upload.invalidFormat'));
      return;
    }

    setSelectedImage({ uri, fileName, fileSize, mimeType });
  };

  const handleTakePhoto = async () => {
    lightHaptic();

    try {
      const result = await pickFromCamera();
      if (result && result.uri) {
        handleImageSelected(result.uri, `photo_${Date.now()}.jpg`, 0, 'image/jpeg');
      }
    } catch (error) {
      Logger.error('Failed to take photo', error as Error);
      toast.error(t('common.error'));
    }
  };

  const handleSelectFromGallery = async () => {
    lightHaptic();

    try {
      const result = await pickFromGallery();
      if (result && result.uri) {
        handleImageSelected(result.uri, `image_${Date.now()}.jpg`, 0, 'image/jpeg');
      }
    } catch (error) {
      Logger.error('Failed to select image', error as Error);
      toast.error(t('common.error'));
    }
  };

  const handleRemoveImage = () => {
    lightHaptic();
    setSelectedImage(null);
  };

  const handleSubmit = async () => {
    if (!selectedImage) {
      toast.error(t('profile.ratingProofs.errors.fileRequired'));
      return;
    }

    if (!title.trim()) {
      toast.error(t('profile.ratingProofs.errors.titleRequired'));
      return;
    }

    mediumHaptic();
    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(selectedImage.uri);
      const blob = await response.blob();
      const fileSize = blob.size;

      const result = await uploadRatingProofFile({
        fileUri: selectedImage.uri,
        fileType: 'image',
        originalName: selectedImage.fileName,
        mimeType: selectedImage.mimeType,
        fileSize,
        userId: user.id,
        playerRatingScoreId,
        title: title.trim(),
        description: description.trim() || undefined,
        onProgress: setUploadProgress,
      });

      if (result.success) {
        toast.success(t('profile.ratingProofs.upload.success'));
        resetForm();
        onSuccess();
        onClose();
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      Logger.error('Failed to upload image proof', error as Error);
      toast.error(t('profile.ratingProofs.errors.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const maxSizeMB = Math.round(getMaxFileSizes().image / (1024 * 1024));

  return (
    <View style={styles.modalContent}>
      {/* Handle indicator */}
      <View style={styles.handleIndicatorRow}>
        <View style={[styles.handleIndicator, { backgroundColor: colors.border }]} />
      </View>

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text
            weight="semibold"
            size="lg"
            style={{ color: colors.text }}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {t('profile.ratingProofs.proofTypes.image.title')}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton} disabled={isSubmitting}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconHeaderContainer}>
          <View style={[styles.iconHeader, { backgroundColor: colors.primary + '20' }]}>
            <Ionicons name="image-outline" size={32} color={colors.primary} />
          </View>
          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('profile.ratingProofs.proofTypes.image.description')}
          </Text>
        </View>

        {/* Image Selection */}
        {!selectedImage ? (
          <View style={styles.selectionContainer}>
            <TouchableOpacity
              style={[
                styles.selectionButton,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
              onPress={handleTakePhoto}
              activeOpacity={0.7}
              disabled={isSubmitting}
            >
              <View style={[styles.selectionIcon, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name="camera-outline" size={28} color={colors.primary} />
              </View>
              <Text size="base" weight="semibold" color={colors.text}>
                {t('profile.ratingProofs.proofTypes.image.takePhoto')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.selectionButton,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
              onPress={handleSelectFromGallery}
              activeOpacity={0.7}
              disabled={isSubmitting}
            >
              <View style={[styles.selectionIcon, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name="images-outline" size={28} color={colors.primary} />
              </View>
              <Text size="base" weight="semibold" color={colors.text}>
                {t('profile.ratingProofs.proofTypes.image.selectFromGallery')}
              </Text>
            </TouchableOpacity>

            <Text size="xs" color={colors.textMuted} style={styles.maxSizeText}>
              {t('profile.ratingProofs.proofTypes.image.maxSize').replace('10', String(maxSizeMB))}
            </Text>
          </View>
        ) : (
          <View style={styles.previewContainer}>
            <View style={styles.imagePreviewWrapper}>
              <Image
                source={{ uri: selectedImage.uri }}
                style={styles.imagePreview}
                resizeMode="cover"
              />
              <TouchableOpacity
                style={[styles.removeButton, { backgroundColor: colors.error }]}
                onPress={handleRemoveImage}
                disabled={isSubmitting}
              >
                <Ionicons name="close-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text size="sm" color={colors.textMuted} style={styles.fileName}>
              {selectedImage.fileName}
            </Text>
          </View>
        )}

        {/* Title Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" color={colors.text} style={styles.label}>
            {t('profile.ratingProofs.form.title')} *
          </Text>
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={title}
            onChangeText={setTitle}
            placeholder={t('profile.ratingProofs.form.titlePlaceholder')}
            placeholderTextColor={colors.textMuted}
            maxLength={100}
            returnKeyType="next"
            editable={!isSubmitting}
          />
        </View>

        {/* Description Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" color={colors.text} style={styles.label}>
            {t('profile.ratingProofs.form.description')}
          </Text>
          <TextInput
            style={[
              styles.textInput,
              styles.textArea,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('profile.ratingProofs.form.descriptionPlaceholder')}
            placeholderTextColor={colors.textMuted}
            maxLength={500}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            editable={!isSubmitting}
          />
        </View>
      </ScrollView>

      {/* Sticky Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {/* Upload Progress */}
        {isSubmitting && uploadProgress > 0 && (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: colors.primary, width: `${uploadProgress}%` },
                ]}
              />
            </View>
            <Text size="xs" color={colors.textMuted} style={styles.progressText}>
              {uploadProgress}%
            </Text>
          </View>
        )}
        <Button
          variant="primary"
          onPress={handleSubmit}
          disabled={isSubmitting || !selectedImage || !title.trim()}
          style={styles.submitButton}
        >
          {isSubmitting ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primaryForeground} />
              <Text
                size="base"
                weight="semibold"
                color={colors.primaryForeground}
                style={styles.loadingText}
              >
                {t('profile.ratingProofs.upload.uploading')}
              </Text>
            </View>
          ) : (
            t('profile.ratingProofs.form.submit')
          )}
        </Button>
      </View>
    </View>
  );
}

export function ImageProofActionSheet({ payload }: SheetProps<'image-proof'>) {
  const onClose = () => {
    SheetManager.hide('image-proof');
  };
  const onSuccess = payload?.onSuccess;
  const playerRatingScoreId = payload?.playerRatingScoreId || '';

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: 'transparent' }]}
      indicatorStyle={[styles.handleIndicator]}
    >
      <ImageProofForm
        onBack={onClose}
        onClose={onClose}
        onSuccess={() => onSuccess?.()}
        playerRatingScoreId={playerRatingScoreId}
      />
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
const ImageProofOverlay: React.FC<ImageProofOverlayProps> = ({
  visible,
  onClose,
  onSuccess,
  playerRatingScoreId,
}) => {
  useEffect(() => {
    if (visible) {
      SheetManager.show('image-proof', {
        payload: {
          onSuccess,
          playerRatingScoreId,
        },
      });
    }
  }, [visible, onSuccess, playerRatingScoreId]);

  useEffect(() => {
    if (!visible) {
      SheetManager.hide('image-proof');
    }
  }, [visible]);

  return null;
};

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  modalContent: {
    flex: 1,
  },
  handleIndicatorRow: {
    alignItems: 'center',
    paddingTop: spacingPixels[2],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
    minHeight: 56,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[12],
  },
  backButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    left: spacingPixels[4],
    zIndex: 1,
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
    zIndex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  iconHeaderContainer: {
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  iconHeader: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    textAlign: 'center',
    paddingHorizontal: spacingPixels[4],
  },
  selectionContainer: {
    gap: spacingPixels[3],
    marginBottom: spacingPixels[4],
  },
  selectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  selectionIcon: {
    width: 48,
    height: 48,
    borderRadius: radiusPixels.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  maxSizeText: {
    textAlign: 'center',
    marginTop: spacingPixels[1],
  },
  previewContainer: {
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  imagePreviewWrapper: {
    position: 'relative',
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  imagePreview: {
    width: 200,
    height: 200,
    borderRadius: radiusPixels.lg,
  },
  removeButton: {
    position: 'absolute',
    top: spacingPixels[2],
    right: spacingPixels[2],
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileName: {
    marginTop: spacingPixels[2],
  },
  inputGroup: {
    marginBottom: spacingPixels[4],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  textInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    fontSize: fontSizePixels.base,
  },
  textArea: {
    minHeight: 80,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  progressContainer: {
    marginBottom: spacingPixels[3],
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    textAlign: 'center',
    marginTop: spacingPixels[1],
  },
  submitButton: {
    width: '100%',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginLeft: spacingPixels[2],
  },
});

export default ImageProofOverlay;
