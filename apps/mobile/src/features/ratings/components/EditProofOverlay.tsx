/**
 * EditProofOverlay
 *
 * A user-friendly bottom sheet overlay for editing existing rating proofs.
 * Allows full editing including:
 * - Title (for all proof types)
 * - Description (for all proof types)
 * - External URL (for external_link proof types)
 * - File replacement (for file-based proofs: image, video, document)
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, Button, useToast } from '@rallia/shared-components';
import { useThemeStyles, useTranslation, useImagePicker } from '../../../hooks';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import {
  updateRatingProof,
  replaceProofFile,
  validateProofFile,
  getMaxFileSizes,
} from '../../../services/ratingProofUpload';
import { Logger, supabase } from '@rallia/shared-services';
import { spacingPixels, radiusPixels, fontSizePixels, status } from '@rallia/design-system';

// Types for new file selection
interface NewFile {
  uri: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export function EditProofActionSheet({ payload }: SheetProps<'edit-proof'>) {
  const proof = payload?.proof;
  const onSuccess = payload?.onSuccess;

  const onClose = () => {
    if (isSubmitting) return;
    SheetManager.hide('edit-proof');
  };

  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { pickFromCamera, pickFromGallery } = useImagePicker();

  // Form state - pre-filled with existing data
  const [title, setTitle] = useState(proof?.title || '');
  const [description, setDescription] = useState(proof?.description || '');
  const [externalUrl, setExternalUrl] = useState(proof?.external_url || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [urlError, setUrlError] = useState<string | null>(null);

  // New file state (when user selects a replacement file)
  const [newFile, setNewFile] = useState<NewFile | null>(null);

  // Check proof type
  const isExternalLink = proof?.proof_type === 'external_link';
  const fileType = proof?.file?.file_type as 'image' | 'video' | 'document' | undefined;

  // Reset form when proof changes
  useEffect(() => {
    if (proof) {
      setTitle(proof.title || '');
      setDescription(proof.description || '');
      setExternalUrl(proof.external_url || '');
      setUrlError(null);
      setNewFile(null);
      setUploadProgress(0);
    }
  }, [proof]);

  // Get proof type display name
  const getProofTypeDisplay = (): string => {
    if (isExternalLink) {
      return t('profile.ratingProofs.proofTypes.externalLink.title');
    }
    switch (fileType) {
      case 'video':
        return t('profile.ratingProofs.proofTypes.video.title');
      case 'image':
        return t('profile.ratingProofs.proofTypes.image.title');
      case 'document':
        return t('profile.ratingProofs.proofTypes.document.title');
      default:
        return t('profile.ratingProofs.title');
    }
  };

  // Get proof type icon
  const getProofTypeIcon = (): keyof typeof Ionicons.glyphMap => {
    if (isExternalLink) return 'link-outline';
    switch (fileType) {
      case 'video':
        return 'videocam-outline';
      case 'image':
        return 'image-outline';
      case 'document':
        return 'document-outline';
      default:
        return 'folder-outline';
    }
  };

  const validateUrl = (urlString: string): boolean => {
    if (!urlString.trim()) {
      setUrlError(t('profile.ratingProofs.errors.invalidUrl'));
      return false;
    }

    try {
      let normalizedUrl = urlString.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'https://' + normalizedUrl;
      }

      const parsedUrl = new URL(normalizedUrl);
      if (!parsedUrl.hostname.includes('.')) {
        setUrlError(t('profile.ratingProofs.errors.invalidUrl'));
        return false;
      }

      setUrlError(null);
      return true;
    } catch {
      setUrlError(t('profile.ratingProofs.errors.invalidUrl'));
      return false;
    }
  };

  const normalizeUrl = (urlString: string): string => {
    let normalized = urlString.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    return normalized;
  };

  const handleOpenUrl = () => {
    if (externalUrl && validateUrl(externalUrl)) {
      const normalizedUrl = normalizeUrl(externalUrl);
      Linking.openURL(normalizedUrl);
    }
  };

  // Image picker handlers
  const handleTakePhoto = async () => {
    lightHaptic();
    try {
      const result = await pickFromCamera();
      if (result && result.uri) {
        const fileName = `photo_${Date.now()}.jpg`;
        const validation = validateProofFile(fileName, 0, 'image');
        if (!validation.valid) {
          toast.error(validation.error || t('profile.ratingProofs.upload.invalidFormat'));
          return;
        }
        setNewFile({
          uri: result.uri,
          fileName,
          fileSize: 0,
          mimeType: 'image/jpeg',
        });
      }
    } catch (error) {
      Logger.error('Failed to take photo', error as Error);
      toast.error(t('common.error'));
    }
  };

  const handleSelectImageFromGallery = async () => {
    lightHaptic();
    try {
      const result = await pickFromGallery();
      if (result && result.uri) {
        const fileName = `image_${Date.now()}.jpg`;
        setNewFile({
          uri: result.uri,
          fileName,
          fileSize: 0,
          mimeType: 'image/jpeg',
        });
      }
    } catch (error) {
      Logger.error('Failed to select image', error as Error);
      toast.error(t('common.error'));
    }
  };

  // Video picker handlers
  const handleRecordVideo = async () => {
    lightHaptic();
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        toast.error(t('errors.permissionsDenied'));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const fileName = asset.fileName || `video_${Date.now()}.mp4`;
        const fileSize = asset.fileSize || 0;

        const validation = validateProofFile(fileName, fileSize, 'video');
        if (!validation.valid) {
          toast.error(validation.error || t('profile.ratingProofs.upload.invalidFormat'));
          return;
        }

        setNewFile({
          uri: asset.uri,
          fileName,
          fileSize,
          mimeType: asset.mimeType || 'video/mp4',
        });
      }
    } catch (error) {
      Logger.error('Failed to record video', error as Error);
      toast.error(t('common.error'));
    }
  };

  const handleSelectVideoFromGallery = async () => {
    lightHaptic();
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        toast.error(t('errors.permissionsDenied'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const fileName = asset.fileName || `video_${Date.now()}.mp4`;
        const fileSize = asset.fileSize || 0;

        const validation = validateProofFile(fileName, fileSize, 'video');
        if (!validation.valid) {
          toast.error(validation.error || t('profile.ratingProofs.upload.invalidFormat'));
          return;
        }

        setNewFile({
          uri: asset.uri,
          fileName,
          fileSize,
          mimeType: asset.mimeType || 'video/mp4',
        });
      }
    } catch (error) {
      Logger.error('Failed to select video', error as Error);
      toast.error(t('common.error'));
    }
  };

  // Document picker handler
  const handleSelectDocument = async () => {
    lightHaptic();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const doc = result.assets[0];

        const validation = validateProofFile(doc.name, doc.size || 0, 'document');
        if (!validation.valid) {
          toast.error(validation.error || t('profile.ratingProofs.upload.invalidFormat'));
          return;
        }

        setNewFile({
          uri: doc.uri,
          fileName: doc.name,
          fileSize: doc.size || 0,
          mimeType: doc.mimeType || 'application/octet-stream',
        });
      }
    } catch (error) {
      Logger.error('Failed to select document', error as Error);
      toast.error(t('common.error'));
    }
  };

  const handleRemoveNewFile = () => {
    lightHaptic();
    setNewFile(null);
    setUploadProgress(0);
  };

  const handleSubmit = async () => {
    if (!proof?.id) return;

    if (!title.trim()) {
      toast.error(t('profile.ratingProofs.errors.titleRequired'));
      return;
    }

    if (isExternalLink && !validateUrl(externalUrl)) {
      return;
    }

    mediumHaptic();
    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      // Get current user for file uploads
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (newFile && fileType && user) {
        // User selected a new file - need to upload and replace
        let fileSize = newFile.fileSize;
        if (!fileSize || fileSize === 0) {
          const response = await fetch(newFile.uri);
          const blob = await response.blob();
          fileSize = blob.size;
        }

        const result = await replaceProofFile({
          proofId: proof.id,
          fileUri: newFile.uri,
          fileType: fileType,
          originalName: newFile.fileName,
          mimeType: newFile.mimeType,
          fileSize,
          userId: user.id,
          title: title.trim(),
          description: description.trim() || undefined,
          onProgress: setUploadProgress,
        });

        if (result.success) {
          toast.success(t('profile.ratingProofs.edit.success'));
          onSuccess?.();
          SheetManager.hide('edit-proof');
        } else {
          throw new Error(result.error || 'Unknown error');
        }
      } else {
        // No new file - just update metadata (title, description, URL)
        const updates: { title?: string; description?: string; external_url?: string } = {
          title: title.trim(),
          description: description.trim(),
        };

        if (isExternalLink) {
          updates.external_url = normalizeUrl(externalUrl);
        }

        const result = await updateRatingProof(proof.id, updates);

        if (result.success) {
          toast.success(t('profile.ratingProofs.edit.success'));
          onSuccess?.();
          SheetManager.hide('edit-proof');
        } else {
          throw new Error(result.error || 'Unknown error');
        }
      }
    } catch (error) {
      Logger.error('Failed to update rating proof', error as Error);
      toast.error(t('profile.ratingProofs.edit.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if form has been modified
  const hasChanges =
    title !== (proof?.title || '') ||
    description !== (proof?.description || '') ||
    (isExternalLink && externalUrl !== (proof?.external_url || '')) ||
    newFile !== null;

  const isDisabled =
    isSubmitting || !title.trim() || (isExternalLink && !externalUrl.trim()) || !hasChanges;

  if (!proof) {
    return null;
  }

  // Render file picker options based on file type
  const renderImagePickerButtons = () => (
    <View style={styles.pickerButtonsRow}>
      <TouchableOpacity
        style={[
          styles.pickerButton,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
        onPress={handleTakePhoto}
        disabled={isSubmitting}
      >
        <Ionicons name="camera-outline" size={24} color={colors.primary} />
        <Text size="sm" color={colors.text} style={styles.pickerButtonText}>
          {t('profile.ratingProofs.proofTypes.image.takePhoto')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.pickerButton,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
        onPress={handleSelectImageFromGallery}
        disabled={isSubmitting}
      >
        <Ionicons name="images-outline" size={24} color={colors.primary} />
        <Text size="sm" color={colors.text} style={styles.pickerButtonText}>
          {t('profile.ratingProofs.proofTypes.image.selectFromGallery')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderVideoPickerButtons = () => (
    <View style={styles.pickerButtonsRow}>
      <TouchableOpacity
        style={[
          styles.pickerButton,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
        onPress={handleRecordVideo}
        disabled={isSubmitting}
      >
        <Ionicons name="videocam-outline" size={24} color={colors.primary} />
        <Text size="sm" color={colors.text} style={styles.pickerButtonText}>
          {t('profile.ratingProofs.proofTypes.video.recordVideo')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.pickerButton,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
        onPress={handleSelectVideoFromGallery}
        disabled={isSubmitting}
      >
        <Ionicons name="folder-open-outline" size={24} color={colors.primary} />
        <Text size="sm" color={colors.text} style={styles.pickerButtonText}>
          {t('profile.ratingProofs.proofTypes.video.selectFromGallery')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderDocumentPickerButton = () => (
    <TouchableOpacity
      style={[
        styles.documentPickerButton,
        { backgroundColor: colors.cardBackground, borderColor: colors.border },
      ]}
      onPress={handleSelectDocument}
      disabled={isSubmitting}
    >
      <Ionicons name="document-outline" size={24} color={colors.primary} />
      <Text size="sm" color={colors.text} style={styles.pickerButtonText}>
        {t('profile.ratingProofs.proofTypes.document.selectDocument')}
      </Text>
    </TouchableOpacity>
  );

  // Render the current or new file preview
  const renderFilePreview = () => {
    // If user selected a new file, show that preview
    if (newFile) {
      return (
        <View style={styles.previewContainer}>
          <View style={[styles.newFileBadge, { backgroundColor: colors.primary }]}>
            <Text size="xs" weight="semibold" color="#FFFFFF">
              {t('profile.ratingProofs.edit.newFile')}
            </Text>
          </View>

          {fileType === 'image' && (
            <Image source={{ uri: newFile.uri }} style={styles.previewImage} resizeMode="cover" />
          )}

          {fileType === 'video' && (
            <View style={styles.videoPreviewContainer}>
              <Video
                source={{ uri: newFile.uri }}
                style={styles.previewVideo}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
                isLooping={false}
                useNativeControls={false}
              />
              <View style={styles.videoOverlay}>
                <Ionicons name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
              </View>
            </View>
          )}

          {fileType === 'document' && (
            <View style={[styles.documentPreview, { backgroundColor: colors.cardBackground }]}>
              <Ionicons name="document-text" size={40} color={colors.primary} />
              <Text size="sm" color={colors.text} numberOfLines={2} style={styles.documentName}>
                {newFile.fileName}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.removeButton, { backgroundColor: colors.error }]}
            onPress={handleRemoveNewFile}
          >
            <Ionicons name="close" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      );
    }

    // Show current file preview
    if (proof.file) {
      return (
        <View style={styles.previewContainer}>
          <View style={[styles.currentFileBadge, { backgroundColor: colors.textMuted }]}>
            <Text size="xs" weight="medium" color="#FFFFFF">
              {t('profile.ratingProofs.edit.currentFile')}
            </Text>
          </View>

          {fileType === 'image' && proof.file.url && (
            <Image
              source={{ uri: proof.file.thumbnail_url || proof.file.url }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          )}

          {fileType === 'video' && proof.file.url && (
            <View style={styles.videoPreviewContainer}>
              {proof.file.thumbnail_url ? (
                <Image
                  source={{ uri: proof.file.thumbnail_url }}
                  style={styles.previewVideo}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={[
                    styles.previewVideo,
                    {
                      backgroundColor: colors.cardBackground,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                  ]}
                >
                  <Ionicons name="videocam" size={40} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.videoOverlay}>
                <Ionicons name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
              </View>
            </View>
          )}

          {fileType === 'document' && (
            <View style={[styles.documentPreview, { backgroundColor: colors.cardBackground }]}>
              <Ionicons name="document-text" size={40} color={colors.primary} />
              <Text size="sm" color={colors.text} numberOfLines={2} style={styles.documentName}>
                {proof.file.original_name}
              </Text>
            </View>
          )}
        </View>
      );
    }

    return null;
  };

  const maxSizeMB = fileType ? Math.round(getMaxFileSizes()[fileType] / (1024 * 1024)) : 0;

  return (
    <ActionSheet
      gestureEnabled={!isSubmitting}
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text
              weight="semibold"
              size="lg"
              style={{ color: colors.text }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {t('profile.ratingProofs.edit.title')}
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
          {/* Proof Type Header */}
          <View style={styles.proofTypeHeader}>
            <View style={[styles.iconHeader, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name={getProofTypeIcon()} size={32} color={colors.primary} />
            </View>
            <View style={styles.proofTypeInfo}>
              <Text size="base" weight="medium" color={colors.text}>
                {getProofTypeDisplay()}
              </Text>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      (proof.status === 'approved'
                        ? status.success.DEFAULT
                        : proof.status === 'rejected'
                          ? status.error.DEFAULT
                          : status.warning.DEFAULT) + '18',
                  },
                ]}
              >
                <Ionicons
                  name={
                    proof.status === 'approved'
                      ? 'checkmark-circle'
                      : proof.status === 'rejected'
                        ? 'close-circle'
                        : 'time-outline'
                  }
                  size={14}
                  color={
                    proof.status === 'approved'
                      ? status.success.DEFAULT
                      : proof.status === 'rejected'
                        ? status.error.DEFAULT
                        : status.warning.DEFAULT
                  }
                />
                <Text
                  size="xs"
                  weight="medium"
                  color={
                    proof.status === 'approved'
                      ? status.success.DEFAULT
                      : proof.status === 'rejected'
                        ? status.error.DEFAULT
                        : status.warning.DEFAULT
                  }
                >
                  {proof.status === 'approved'
                    ? t('profile.ratingProofs.status.approved')
                    : proof.status === 'rejected'
                      ? t('profile.ratingProofs.status.rejected')
                      : t('profile.ratingProofs.status.pending')}
                </Text>
              </View>
            </View>
          </View>

          {/* File/URL Section */}
          {isExternalLink ? (
            // External URL Input
            <View style={styles.inputGroup}>
              <Text size="sm" weight="medium" color={colors.text} style={styles.label}>
                {t('profile.ratingProofs.proofTypes.externalLink.urlLabel')} *
              </Text>
              <View
                style={[
                  styles.urlInputContainer,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: urlError ? colors.error : colors.border,
                  },
                ]}
              >
                <TextInput
                  style={[styles.urlInput, { color: colors.text }]}
                  value={externalUrl}
                  onChangeText={text => {
                    setExternalUrl(text);
                    setUrlError(null);
                  }}
                  placeholder={t('profile.ratingProofs.proofTypes.externalLink.placeholder')}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="next"
                  editable={!isSubmitting}
                />
                {externalUrl.length > 0 && (
                  <TouchableOpacity onPress={handleOpenUrl} style={styles.urlPreviewButton}>
                    <Ionicons name="open-outline" size={20} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
              {urlError && (
                <Text size="xs" color={colors.error} style={styles.errorText}>
                  {urlError}
                </Text>
              )}
            </View>
          ) : (
            // File Preview and Replace Section
            <View style={styles.fileSection}>
              <Text size="sm" weight="medium" color={colors.text} style={styles.label}>
                {t('profile.ratingProofs.edit.proofFile')}
              </Text>

              {/* Preview */}
              {renderFilePreview()}

              {/* Upload Progress */}
              {isSubmitting && uploadProgress > 0 && uploadProgress < 100 && (
                <View style={styles.progressContainer}>
                  <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${uploadProgress}%`, backgroundColor: colors.primary },
                      ]}
                    />
                  </View>
                  <Text size="xs" color={colors.textMuted} style={styles.progressText}>
                    {t('profile.ratingProofs.upload.progress', {
                      percent: Math.round(uploadProgress),
                    })}
                  </Text>
                </View>
              )}

              {/* Replace File Buttons */}
              {!newFile && !isSubmitting && (
                <View style={styles.replaceSection}>
                  <Text
                    size="sm"
                    weight="medium"
                    color={colors.text}
                    style={styles.replaceSectionTitle}
                  >
                    {t('profile.ratingProofs.edit.replaceFile')}
                  </Text>
                  {fileType === 'image' && renderImagePickerButtons()}
                  {fileType === 'video' && renderVideoPickerButtons()}
                  {fileType === 'document' && renderDocumentPickerButton()}
                  <Text size="xs" color={colors.textMuted} style={styles.maxSizeHint}>
                    {t('profile.ratingProofs.upload.maxSize', { size: maxSizeMB })}
                  </Text>
                </View>
              )}
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

          {/* Info about status reset when replacing file */}
          {newFile && (
            <View
              style={[
                styles.infoBox,
                { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' },
              ]}
            >
              <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
              <Text size="sm" color={colors.text} style={styles.infoText}>
                {t('profile.ratingProofs.edit.statusResetInfo')}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Button
            variant="primary"
            onPress={handleSubmit}
            disabled={isDisabled}
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
                  {uploadProgress > 0
                    ? t('profile.ratingProofs.upload.uploading')
                    : t('common.saving')}
                </Text>
              </View>
            ) : (
              <Text size="base" weight="semibold" color={colors.primaryForeground}>
                {t('profile.ratingProofs.edit.save')}
              </Text>
            )}
          </Button>
        </View>
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
  modalContent: {
    flex: 1,
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
  proofTypeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
    gap: spacingPixels[3],
  },
  iconHeader: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofTypeInfo: {
    flex: 1,
    gap: spacingPixels[1],
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  inputGroup: {
    marginBottom: spacingPixels[3],
  },
  label: {
    marginBottom: spacingPixels[1],
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
    paddingTop: spacingPixels[3],
  },
  urlInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingRight: spacingPixels[2],
  },
  urlInput: {
    flex: 1,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    fontSize: fontSizePixels.base,
  },
  urlPreviewButton: {
    padding: spacingPixels[1],
  },
  errorText: {
    marginTop: spacingPixels[1],
  },
  fileSection: {
    marginBottom: spacingPixels[3],
  },
  previewContainer: {
    position: 'relative',
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.md,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: radiusPixels.md,
  },
  videoPreviewContainer: {
    position: 'relative',
    width: '100%',
    height: 180,
    borderRadius: radiusPixels.md,
    overflow: 'hidden',
  },
  previewVideo: {
    width: '100%',
    height: '100%',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  documentPreview: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    gap: spacingPixels[2],
  },
  documentName: {
    textAlign: 'center',
  },
  newFileBadge: {
    position: 'absolute',
    top: spacingPixels[2],
    left: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    zIndex: 10,
  },
  currentFileBadge: {
    position: 'absolute',
    top: spacingPixels[2],
    left: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    zIndex: 10,
  },
  removeButton: {
    position: 'absolute',
    top: spacingPixels[2],
    right: spacingPixels[2],
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  replaceSection: {
    marginTop: spacingPixels[2],
  },
  replaceSectionTitle: {
    marginBottom: spacingPixels[2],
  },
  pickerButtonsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  pickerButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  documentPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  pickerButtonText: {
    textAlign: 'center',
  },
  maxSizeHint: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  progressContainer: {
    marginTop: spacingPixels[2],
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
    marginTop: spacingPixels[1],
    textAlign: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  infoText: {
    flex: 1,
  },
  footer: {
    borderTopWidth: 1,
    padding: spacingPixels[4],
  },
  submitButton: {
    width: '100%',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  loadingText: {
    marginLeft: spacingPixels[1],
  },
});

export default EditProofActionSheet;
