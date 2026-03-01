/**
 * ReportUserModal
 * Modal for reporting a user with reason selection and optional description
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  Image,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation, useImagePicker } from '../../../hooks';
import { createUserReport, type ReportReason, REPORT_REASON_LABELS } from '@rallia/shared-services';
import { radiusPixels, primary, status, spacingPixels } from '@rallia/design-system';
import { ReportSubmittedSuccessModal } from './ReportSubmittedSuccessModal';
import { uploadImage } from '../../../services/imageUpload';

// Report reasons that allow evidence/proof images
const EVIDENCE_REPORT_REASONS: ReportReason[] = [
  'cheating',
  'inappropriate_behavior',
  'harassment',
];

const REPORT_REASONS: ReportReason[] = [
  'inappropriate_behavior',
  'harassment',
  'spam',
  'cheating',
  'other',
];

export function ReportUserActionSheet({ payload }: SheetProps<'report-user'>) {
  const reporterId = payload?.reporterId ?? '';
  const reportedId = payload?.reportedId ?? '';
  const reportedName = payload?.reportedName ?? '';
  const conversationId = payload?.conversationId;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [evidenceImages, setEvidenceImages] = useState<string[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  const { pickFromGallery } = useImagePicker();

  // Check if current reason allows evidence images
  const canAddEvidence = selectedReason && EVIDENCE_REPORT_REASONS.includes(selectedReason);

  const handleClose = useCallback(() => {
    setSelectedReason(null);
    setDescription('');
    setEvidenceImages([]);
    SheetManager.hide('report-user');
  }, []);

  const handleSuccessModalClose = useCallback(() => {
    setShowSuccessModal(false);
    handleClose();
  }, [handleClose]);

  const handleAddEvidence = useCallback(async () => {
    if (evidenceImages.length >= 3) {
      Alert.alert(t('common.error'), t('chat.report.maxImages'));
      return;
    }

    const result = await pickFromGallery();
    if (result.uri) {
      setEvidenceImages(prev => [...prev, result.uri!]);
    }
  }, [evidenceImages.length, pickFromGallery, t]);

  const handleRemoveEvidence = useCallback((index: number) => {
    setEvidenceImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedReason) {
      Alert.alert(t('common.error'), t('chat.report.pleaseSelectReason'));
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload evidence images if any
      let uploadedUrls: string[] = [];
      if (evidenceImages.length > 0) {
        setIsUploadingImages(true);
        const uploadPromises = evidenceImages.map(uri =>
          uploadImage(uri, 'report-evidence', reporterId)
        );
        const results = await Promise.all(uploadPromises);
        uploadedUrls = results.filter(r => r.url !== null).map(r => r.url as string);
        setIsUploadingImages(false);
      }

      await createUserReport({
        reporterId,
        reportedId,
        reason: selectedReason,
        description: description.trim() || undefined,
        conversationId,
        evidenceUrls: uploadedUrls.length > 0 ? uploadedUrls : undefined,
      });

      // Show animated success modal
      setShowSuccessModal(true);
    } catch (error) {
      Alert.alert(
        t('common.error'),
        error instanceof Error ? error.message : t('chat.report.failedToSubmit')
      );
    } finally {
      setIsSubmitting(false);
      setIsUploadingImages(false);
    }
  }, [selectedReason, description, reporterId, reportedId, conversationId, evidenceImages, t]);

  return (
    <>
      <ActionSheet
        gestureEnabled
        containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
        indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      >
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text weight="semibold" size="lg" style={{ color: colors.text }}>
              {t('chat.report.reportUser', { name: reportedName })}
            </Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Scrollable content */}
          <ScrollView
            style={styles.contentContainer}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Warning text */}
            <View
              style={[
                styles.warningBox,
                {
                  backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.1)',
                },
              ]}
            >
              <Ionicons name="warning-outline" size={20} color={status.warning.DEFAULT} />
              <Text
                size="sm"
                style={{
                  color: isDark ? status.warning.light : status.warning.dark,
                  flex: 1,
                  marginLeft: 8,
                }}
              >
                {t('chat.report.warningText')}
              </Text>
            </View>

            {/* Reason selection */}
            <Text weight="medium" style={{ color: colors.text, marginBottom: 12, marginTop: 16 }}>
              {t('chat.report.selectReason')}
            </Text>

            {REPORT_REASONS.map(reason => (
              <TouchableOpacity
                key={reason}
                style={[
                  styles.reasonOption,
                  {
                    backgroundColor:
                      selectedReason === reason
                        ? isDark
                          ? primary[900]
                          : primary[50]
                        : isDark
                          ? '#2C2C2E'
                          : '#F2F2F7',
                    borderColor: selectedReason === reason ? primary[500] : 'transparent',
                  },
                ]}
                onPress={() => setSelectedReason(reason)}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    color: selectedReason === reason ? primary[500] : colors.text,
                    flex: 1,
                  }}
                >
                  {REPORT_REASON_LABELS[reason]}
                </Text>
                {selectedReason === reason && (
                  <Ionicons name="checkmark-circle-outline" size={20} color={primary[500]} />
                )}
              </TouchableOpacity>
            ))}

            {/* Description input */}
            <Text weight="medium" style={{ color: colors.text, marginBottom: 12, marginTop: 20 }}>
              {t('chat.report.additionalDetails')}
            </Text>
            <TextInput
              style={[
                styles.descriptionInput,
                {
                  backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7',
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              placeholder={t('chat.report.provideContext')}
              placeholderTextColor={colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              maxLength={500}
            />
            <Text size="xs" style={{ color: colors.textMuted, textAlign: 'right', marginTop: 4 }}>
              {description.length}/500
            </Text>

            {/* Evidence images section - only for certain report types */}
            {canAddEvidence && (
              <View style={styles.evidenceSection}>
                <Text weight="medium" style={{ color: colors.text, marginBottom: 8 }}>
                  {t('chat.report.addEvidence')}
                </Text>
                <Text size="xs" style={{ color: colors.textMuted, marginBottom: 12 }}>
                  {t('chat.report.evidenceHint')}
                </Text>

                {/* Evidence images grid */}
                <View style={styles.evidenceGrid}>
                  {evidenceImages.map((uri, index) => (
                    <View key={index} style={styles.evidenceImageContainer}>
                      <Image source={{ uri }} style={styles.evidenceImage} />
                      <TouchableOpacity
                        style={[
                          styles.removeImageButton,
                          { backgroundColor: status.error.DEFAULT },
                        ]}
                        onPress={() => handleRemoveEvidence(index)}
                      >
                        <Ionicons name="close" size={14} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}

                  {/* Add image button */}
                  {evidenceImages.length < 3 && (
                    <TouchableOpacity
                      style={[
                        styles.addEvidenceButton,
                        {
                          backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7',
                          borderColor: colors.border,
                        },
                      ]}
                      onPress={handleAddEvidence}
                    >
                      <Ionicons name="camera-outline" size={24} color={colors.textMuted} />
                      <Text size="xs" style={{ color: colors.textMuted, marginTop: 4 }}>
                        {t('chat.report.addPhoto')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text size="xs" style={{ color: colors.textMuted, marginTop: 8 }}>
                  {t('chat.report.maxPhotos', { current: evidenceImages.length, max: 3 })}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Sticky footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[
                styles.submitButton,
                {
                  backgroundColor: selectedReason ? status.error.DEFAULT : colors.textMuted,
                  opacity: isSubmitting ? 0.6 : 1,
                },
              ]}
              onPress={handleSubmit}
              disabled={!selectedReason || isSubmitting}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                  <Text size="lg" weight="semibold" color="#fff">
                    {isUploadingImages ? t('chat.report.uploadingImages') : t('common.submitting')}
                  </Text>
                </View>
              ) : (
                <>
                  <Ionicons name="flag-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                  <Text size="lg" weight="semibold" color="#fff">
                    {t('chat.report.submit')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ActionSheet>

      {/* Success Modal */}
      <ReportSubmittedSuccessModal visible={showSuccessModal} onClose={handleSuccessModalClose} />
    </>
  );
}

// Keep old export for backwards compatibility during migration
export const ReportUserModal = ReportUserActionSheet;

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
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  contentContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radiusPixels.md,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: radiusPixels.md,
    marginBottom: 8,
    borderWidth: 2,
  },
  descriptionInput: {
    borderRadius: radiusPixels.md,
    padding: 12,
    minHeight: 100,
    borderWidth: 1,
    fontSize: 14,
  },
  evidenceSection: {
    marginTop: 20,
  },
  evidenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  evidenceImageContainer: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.md,
    overflow: 'hidden',
    position: 'relative',
  },
  evidenceImage: {
    width: '100%',
    height: '100%',
    borderRadius: radiusPixels.md,
  },
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addEvidenceButton: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
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
