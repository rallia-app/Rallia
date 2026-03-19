import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, Button, useToast } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import {
  uploadRatingProofFile,
  validateProofFile,
  getMaxFileSizes,
  getSupportedVideoFormats,
} from '../../../services/ratingProofUpload';
import { isBackblazeConfigured, getBackblazeConfigStatus } from '../../../services/backblazeUpload';
import { Logger, supabase } from '@rallia/shared-services';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import type { ProofFormProps } from './AddRatingProofOverlay';

interface VideoProofOverlayProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  playerRatingScoreId: string;
}

const MAX_VIDEO_DURATION_SECONDS = 60; // 1 minute

export function VideoProofForm({
  onBack,
  onClose,
  onSuccess,
  playerRatingScoreId,
}: ProofFormProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const [selectedVideo, setSelectedVideo] = useState<{
    uri: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    duration?: number;
  } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const resetForm = () => {
    setSelectedVideo(null);
    setTitle('');
    setDescription('');
    setUploadProgress(0);
  };

  const handleVideoSelected = (
    uri: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
    duration?: number
  ) => {
    const validation = validateProofFile(fileName, fileSize, 'video');
    if (!validation.valid) {
      toast.error(validation.error || t('profile.ratingProofs.upload.invalidFormat'));
      return;
    }

    if (duration && duration > MAX_VIDEO_DURATION_SECONDS) {
      toast.error(t('profile.ratingProofs.proofTypes.video.maxDuration'));
      return;
    }

    setSelectedVideo({ uri, fileName, fileSize, mimeType, duration });
  };

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
        videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const fileName = asset.fileName || `video_${Date.now()}.mp4`;
        const fileSize = asset.fileSize || 0;
        const mimeType = asset.mimeType || 'video/mp4';
        const duration = asset.duration ? asset.duration / 1000 : undefined;

        handleVideoSelected(asset.uri, fileName, fileSize, mimeType, duration);
      }
    } catch (error) {
      Logger.error('Failed to record video', error as Error);
      toast.error(t('common.error'));
    }
  };

  const handleSelectFromGallery = async () => {
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
        videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const fileName = asset.fileName || `video_${Date.now()}.mp4`;
        const fileSize = asset.fileSize || 0;
        const mimeType = asset.mimeType || 'video/mp4';
        const duration = asset.duration ? asset.duration / 1000 : undefined;

        handleVideoSelected(asset.uri, fileName, fileSize, mimeType, duration);
      }
    } catch (error) {
      Logger.error('Failed to select video', error as Error);
      toast.error(t('common.error'));
    }
  };

  const handleRemoveVideo = () => {
    lightHaptic();
    setSelectedVideo(null);
  };

  const handleSubmit = async () => {
    if (!selectedVideo) {
      toast.error(t('profile.ratingProofs.errors.fileRequired'));
      return;
    }

    if (!title.trim()) {
      toast.error(t('profile.ratingProofs.errors.titleRequired'));
      return;
    }

    if (!isBackblazeConfigured()) {
      Logger.warn('Backblaze not configured', getBackblazeConfigStatus());
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

      let fileSize = selectedVideo.fileSize;
      if (!fileSize || fileSize === 0) {
        const response = await fetch(selectedVideo.uri);
        const blob = await response.blob();
        fileSize = blob.size;
      }

      const result = await uploadRatingProofFile({
        fileUri: selectedVideo.uri,
        fileType: 'video',
        originalName: selectedVideo.fileName,
        mimeType: selectedVideo.mimeType,
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
      Logger.error('Failed to upload video proof', error as Error);
      toast.error(t('profile.ratingProofs.errors.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return 'Unknown size';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const maxSizeMB = Math.round(getMaxFileSizes().video / (1024 * 1024));
  const supportedFormats = getSupportedVideoFormats().join(', ').toUpperCase();

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
            {t('profile.ratingProofs.proofTypes.video.title')}
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
            <Ionicons name="videocam-outline" size={32} color={colors.primary} />
          </View>
          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('profile.ratingProofs.proofTypes.video.description')}
          </Text>
        </View>

        {/* Video Selection */}
        {!selectedVideo ? (
          <View style={styles.selectionContainer}>
            <TouchableOpacity
              style={[
                styles.selectionButton,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
              onPress={handleRecordVideo}
              activeOpacity={0.7}
              disabled={isSubmitting}
            >
              <View style={[styles.selectionIcon, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name="videocam" size={28} color={colors.primary} />
              </View>
              <View style={styles.selectionContent}>
                <Text size="base" weight="semibold" color={colors.text}>
                  {t('profile.ratingProofs.proofTypes.video.recordVideo')}
                </Text>
                <Text size="xs" color={colors.textMuted}>
                  Record a new video now
                </Text>
              </View>
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
                <Ionicons name="folder-open-outline" size={28} color={colors.primary} />
              </View>
              <View style={styles.selectionContent}>
                <Text size="base" weight="semibold" color={colors.text}>
                  {t('profile.ratingProofs.proofTypes.video.selectFromGallery')}
                </Text>
                <Text size="xs" color={colors.textMuted}>
                  Choose an existing video
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.infoContainer}>
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  {t('profile.ratingProofs.proofTypes.video.maxDuration')}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="cloud-upload-outline" size={14} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  Max size: {maxSizeMB} MB
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="document-outline" size={14} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  Formats: {supportedFormats}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.previewContainer}>
            <View style={styles.videoPreviewWrapper}>
              <Video
                source={{ uri: selectedVideo.uri }}
                style={styles.videoPreview}
                resizeMode={ResizeMode.COVER}
                useNativeControls
                isLooping={false}
              />
              <TouchableOpacity
                style={[styles.removeButton, { backgroundColor: colors.error }]}
                onPress={handleRemoveVideo}
                disabled={isSubmitting}
              >
                <Ionicons name="close-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.videoInfo}>
              <Text size="sm" color={colors.text} weight="medium">
                {selectedVideo.fileName}
              </Text>
              <View style={styles.videoMeta}>
                {selectedVideo.duration && (
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                    <Text size="xs" color={colors.textMuted}>
                      {formatDuration(selectedVideo.duration)}
                    </Text>
                  </View>
                )}
                <View style={styles.metaItem}>
                  <Ionicons name="document-outline" size={12} color={colors.textMuted} />
                  <Text size="xs" color={colors.textMuted}>
                    {formatFileSize(selectedVideo.fileSize)}
                  </Text>
                </View>
              </View>
            </View>
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
        {isSubmitting && (
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
              {uploadProgress < 100
                ? `${t('profile.ratingProofs.upload.uploading')} ${uploadProgress}%`
                : t('profile.ratingProofs.upload.processing')}
            </Text>
          </View>
        )}
        <Button
          variant="primary"
          onPress={handleSubmit}
          disabled={isSubmitting || !selectedVideo || !title.trim()}
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
                {uploadProgress < 100
                  ? t('profile.ratingProofs.upload.uploading')
                  : t('profile.ratingProofs.upload.processing')}
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

export function VideoProofActionSheet({ payload }: SheetProps<'video-proof'>) {
  const onClose = () => {
    SheetManager.hide('video-proof');
  };
  const onSuccess = payload?.onSuccess;
  const playerRatingScoreId = payload?.playerRatingScoreId || '';

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: 'transparent' }]}
      indicatorStyle={[styles.handleIndicator]}
    >
      <VideoProofForm
        onBack={onClose}
        onClose={onClose}
        onSuccess={() => onSuccess?.()}
        playerRatingScoreId={playerRatingScoreId}
      />
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
const VideoProofOverlay: React.FC<VideoProofOverlayProps> = ({
  visible,
  onClose,
  onSuccess,
  playerRatingScoreId,
}) => {
  useEffect(() => {
    if (visible) {
      SheetManager.show('video-proof', {
        payload: {
          onSuccess,
          playerRatingScoreId,
        },
      });
    }
  }, [visible, onSuccess, playerRatingScoreId]);

  useEffect(() => {
    if (!visible) {
      SheetManager.hide('video-proof');
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
  selectionContent: {
    flex: 1,
  },
  infoContainer: {
    padding: spacingPixels[3],
    gap: spacingPixels[2],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  previewContainer: {
    marginBottom: spacingPixels[4],
  },
  videoPreviewWrapper: {
    position: 'relative',
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  videoPreview: {
    width: '100%',
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
  videoInfo: {
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
  },
  videoMeta: {
    flexDirection: 'row',
    gap: spacingPixels[4],
    marginTop: spacingPixels[1],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
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
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    textAlign: 'center',
    marginTop: spacingPixels[2],
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

export default VideoProofOverlay;
