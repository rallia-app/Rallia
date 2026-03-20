import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, Button, useToast } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import {
  uploadRatingProofFile,
  validateProofFile,
  getMaxFileSizes,
} from '../../../services/ratingProofUpload';
import { Logger, supabase } from '@rallia/shared-services';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import type { ProofFormProps } from './AddRatingProofOverlay';

interface DocumentProofOverlayProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  playerRatingScoreId: string;
}

export function DocumentProofForm({
  onBack,
  onClose,
  onSuccess,
  playerRatingScoreId,
}: ProofFormProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const [selectedDocument, setSelectedDocument] = useState<{
    uri: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const resetForm = () => {
    setSelectedDocument(null);
    setTitle('');
    setDescription('');
    setUploadProgress(0);
  };

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

        setSelectedDocument({
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

  const handleRemoveDocument = () => {
    lightHaptic();
    setSelectedDocument(null);
  };

  const handleSubmit = async () => {
    if (!selectedDocument) {
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

      let fileSize = selectedDocument.fileSize;
      if (!fileSize || fileSize === 0) {
        const response = await fetch(selectedDocument.uri);
        const blob = await response.blob();
        fileSize = blob.size;
      }

      const result = await uploadRatingProofFile({
        fileUri: selectedDocument.uri,
        fileType: 'document',
        originalName: selectedDocument.fileName,
        mimeType: selectedDocument.mimeType,
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
      Logger.error('Failed to upload document proof', error as Error);
      toast.error(t('profile.ratingProofs.errors.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getDocumentIcon = (mimeType: string): string => {
    if (mimeType === 'application/pdf') return 'document-text';
    if (mimeType.includes('word')) return 'document';
    if (mimeType === 'text/plain') return 'document-outline';
    return 'document-attach';
  };

  const getDocumentTypeLabel = (mimeType: string): string => {
    if (mimeType === 'application/pdf') return 'PDF Document';
    if (mimeType.includes('word')) return 'Word Document';
    if (mimeType === 'text/plain') return 'Text File';
    return 'Document';
  };

  const maxSizeMB = Math.round(getMaxFileSizes().document / (1024 * 1024));

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
            {t('profile.ratingProofs.proofTypes.document.title')}
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
            <Ionicons name="document-text-outline" size={32} color={colors.primary} />
          </View>
          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('profile.ratingProofs.proofTypes.document.description')}
          </Text>
        </View>

        {/* Document Selection */}
        {!selectedDocument ? (
          <View style={styles.selectionContainer}>
            <TouchableOpacity
              style={[
                styles.uploadArea,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
              onPress={handleSelectDocument}
              activeOpacity={0.7}
              disabled={isSubmitting}
            >
              <View style={[styles.uploadIcon, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name="cloud-upload-outline" size={32} color={colors.primary} />
              </View>
              <Text size="base" weight="semibold" color={colors.text} style={styles.uploadTitle}>
                {t('profile.ratingProofs.proofTypes.document.selectDocument')}
              </Text>
              <Text size="sm" color={colors.textMuted} style={styles.uploadSubtitle}>
                Tap to browse your files
              </Text>
            </TouchableOpacity>

            <View style={styles.supportedFormatsContainer}>
              <Text size="xs" weight="medium" color={colors.textMuted} style={styles.formatLabel}>
                Supported formats
              </Text>
              <View style={styles.formatTags}>
                {['PDF', 'DOC', 'DOCX', 'TXT'].map(format => (
                  <View key={format} style={[styles.formatTag, { backgroundColor: colors.border }]}>
                    <Text size="xs" color={colors.textMuted}>
                      {format}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.infoContainer}>
              <View style={styles.infoRow}>
                <Ionicons name="cloud-upload-outline" size={14} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  Max size: {maxSizeMB} MB
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="shield-checkmark-outline" size={14} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  Documents are stored securely
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.previewContainer}>
            <View
              style={[
                styles.documentPreview,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <View
                style={[styles.documentIconWrapper, { backgroundColor: colors.primary + '20' }]}
              >
                <Ionicons
                  name={
                    getDocumentIcon(selectedDocument.mimeType) as keyof typeof Ionicons.glyphMap
                  }
                  size={40}
                  color={colors.primary}
                />
              </View>
              <View style={styles.documentInfo}>
                <Text size="sm" weight="medium" color={colors.text} numberOfLines={2}>
                  {selectedDocument.fileName}
                </Text>
                <View style={styles.documentMeta}>
                  <Text size="xs" color={colors.textMuted}>
                    {getDocumentTypeLabel(selectedDocument.mimeType)}
                  </Text>
                  <Text size="xs" color={colors.textMuted}>
                    •
                  </Text>
                  <Text size="xs" color={colors.textMuted}>
                    {formatFileSize(selectedDocument.fileSize)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.removeButton, { backgroundColor: colors.error }]}
                onPress={handleRemoveDocument}
                disabled={isSubmitting}
              >
                <Ionicons name="close-outline" size={18} color="#fff" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.changeButton}
              onPress={handleSelectDocument}
              disabled={isSubmitting}
            >
              <Ionicons name="swap-horizontal-outline" size={16} color={colors.primary} />
              <Text size="sm" color={colors.primary}>
                Choose different file
              </Text>
            </TouchableOpacity>
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
          disabled={isSubmitting || !selectedDocument || !title.trim()}
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

export function DocumentProofActionSheet({ payload }: SheetProps<'document-proof'>) {
  const onClose = () => {
    SheetManager.hide('document-proof');
  };
  const onSuccess = payload?.onSuccess;
  const playerRatingScoreId = payload?.playerRatingScoreId || '';

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: 'transparent' }]}
      indicatorStyle={[styles.handleIndicator]}
    >
      <DocumentProofForm
        onBack={onClose}
        onClose={onClose}
        onSuccess={() => onSuccess?.()}
        playerRatingScoreId={playerRatingScoreId}
      />
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
const DocumentProofOverlay: React.FC<DocumentProofOverlayProps> = ({
  visible,
  onClose,
  onSuccess,
  playerRatingScoreId,
}) => {
  useEffect(() => {
    if (visible) {
      SheetManager.show('document-proof', {
        payload: {
          onSuccess,
          playerRatingScoreId,
        },
      });
    }
  }, [visible, onSuccess, playerRatingScoreId]);

  useEffect(() => {
    if (!visible) {
      SheetManager.hide('document-proof');
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
    marginBottom: spacingPixels[4],
  },
  uploadArea: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
    borderRadius: radiusPixels.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  uploadIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  uploadTitle: {
    marginBottom: spacingPixels[1],
  },
  uploadSubtitle: {
    textAlign: 'center',
  },
  supportedFormatsContainer: {
    alignItems: 'center',
    marginTop: spacingPixels[4],
  },
  formatLabel: {
    marginBottom: spacingPixels[2],
  },
  formatTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  formatTag: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  infoContainer: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  previewContainer: {
    marginBottom: spacingPixels[4],
  },
  documentPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  documentIconWrapper: {
    width: 56,
    height: 56,
    borderRadius: radiusPixels.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  documentInfo: {
    flex: 1,
    marginHorizontal: spacingPixels[3],
  },
  documentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[1],
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  changeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
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

export default DocumentProofOverlay;
