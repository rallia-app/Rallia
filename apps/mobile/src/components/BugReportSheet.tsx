/**
 * Bug Report Bottom Sheet
 *
 * A quick-access bottom sheet for reporting bugs.
 * Can be triggered via shake gesture or help menu.
 * Includes subject field and screenshot support for better bug reports.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Image,
  Modal,
} from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { Text, useToast } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { submitUserFeedback, Logger, type UserFeedbackModule } from '@rallia/shared-services';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';

import { useAuth, useTranslation, type TranslationKey, useImagePicker } from '../hooks';
import { useBugReportSheet } from '../context/BugReportSheetContext';
import { uploadImage } from '../services/imageUpload';

const BASE_WHITE = '#ffffff';
const MIN_SUBJECT_LENGTH = 3;
const MAX_SUBJECT_LENGTH = 100;
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 500;
const MAX_SCREENSHOTS = 3;

// Quick module options for bug context
interface QuickModuleOption {
  value: UserFeedbackModule;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}

const QUICK_MODULES: QuickModuleOption[] = [
  { value: 'match_features', icon: 'people-outline', labelKey: 'bugReport.modules.matches' },
  { value: 'messaging', icon: 'chatbubble-outline', labelKey: 'bugReport.modules.chat' },
  { value: 'profile_settings', icon: 'person-outline', labelKey: 'bugReport.modules.profile' },
  { value: 'other', icon: 'apps-outline', labelKey: 'bugReport.modules.other' },
];

export const BugReportSheet: React.FC = () => {
  const { sheetRef, closeBugReport, trigger } = useBugReportSheet();
  const { theme } = useTheme();
  const { session } = useAuth();
  const { t } = useTranslation();
  const toast = useToast();
  const isDark = theme === 'dark';
  const { pickFromGallery, pickFromCamera } = useImagePicker();

  // Form state
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [selectedModule, setSelectedModule] = useState<UserFeedbackModule>('other');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showImageSourceModal, setShowImageSourceModal] = useState(false);

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      inputBackground: isDark ? neutral[800] : neutral[50],
      inputBorder: themeColors.border,
      inputText: themeColors.foreground,
      inputPlaceholder: themeColors.mutedForeground,
      buttonPrimary: status.error.DEFAULT,
      buttonPrimaryText: BASE_WHITE,
      buttonDisabled: themeColors.muted,
      buttonDisabledText: themeColors.mutedForeground,
      chipActive: status.error.DEFAULT,
      chipInactive: themeColors.muted,
      chipTextActive: BASE_WHITE,
      chipTextInactive: themeColors.foreground,
    }),
    [themeColors, isDark]
  );

  // Validation
  const subjectValid = subject.trim().length >= MIN_SUBJECT_LENGTH;
  const messageValid = message.trim().length >= MIN_MESSAGE_LENGTH;
  const isValid = subjectValid && messageValid;

  // Snap points - larger to accommodate screenshots
  const snapPoints = useMemo(() => ['90%'], []);

  // Backdrop
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    []
  );

  // Reset form when sheet closes
  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) {
      // Sheet closed - reset form
      setTimeout(() => {
        setSubject('');
        setMessage('');
        setSelectedModule('other');
        setScreenshots([]);
        setIsSubmitting(false);
        setIsUploadingImage(false);
      }, 300);
    }
  }, []);

  // Handle module selection
  const handleModuleSelect = useCallback((mod: UserFeedbackModule) => {
    void lightHaptic();
    setSelectedModule(mod);
  }, []);

  // Handle add screenshot
  const handleAddScreenshot = useCallback(() => {
    if (screenshots.length >= MAX_SCREENSHOTS) {
      toast.error(t('feedback.maxScreenshotsReached' as TranslationKey, { max: MAX_SCREENSHOTS }));
      return;
    }
    setShowImageSourceModal(true);
  }, [screenshots.length, toast, t]);

  // Handle pick from gallery
  const handlePickFromGallery = useCallback(async () => {
    setShowImageSourceModal(false);
    setIsUploadingImage(true);

    try {
      const result = await pickFromGallery();
      if (result.uri) {
        const uploadResult = await uploadImage(
          result.uri,
          'feedback-screenshots',
          session?.user?.id
        );
        if (uploadResult.url) {
          setScreenshots(prev => [...prev, uploadResult.url!]);
          void lightHaptic();
        } else {
          toast.error(t('feedback.screenshotUploadError' as TranslationKey));
        }
      }
    } catch (error) {
      Logger.error('Failed to upload screenshot from gallery', error as Error);
      toast.error(t('feedback.screenshotUploadError' as TranslationKey));
    } finally {
      setIsUploadingImage(false);
    }
  }, [pickFromGallery, session?.user?.id, toast, t]);

  // Handle pick from camera
  const handlePickFromCamera = useCallback(async () => {
    setShowImageSourceModal(false);
    setIsUploadingImage(true);

    try {
      const result = await pickFromCamera();
      if (result.uri) {
        const uploadResult = await uploadImage(
          result.uri,
          'feedback-screenshots',
          session?.user?.id
        );
        if (uploadResult.url) {
          setScreenshots(prev => [...prev, uploadResult.url!]);
          void lightHaptic();
        } else {
          toast.error(t('feedback.screenshotUploadError' as TranslationKey));
        }
      }
    } catch (error) {
      Logger.error('Failed to upload screenshot from camera', error as Error);
      toast.error(t('feedback.screenshotUploadError' as TranslationKey));
    } finally {
      setIsUploadingImage(false);
    }
  }, [pickFromCamera, session?.user?.id, toast, t]);

  // Handle remove screenshot
  const handleRemoveScreenshot = useCallback((index: number) => {
    void warningHaptic();
    setScreenshots(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Handle submit
  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;

    void lightHaptic();
    setIsSubmitting(true);

    try {
      await submitUserFeedback({
        playerId: session?.user?.id,
        category: 'bug',
        module: selectedModule,
        subject: subject.trim(),
        message: message.trim(),
        screenshotUrls: screenshots.length > 0 ? screenshots : undefined,
        deviceInfo: {
          platform: Platform.OS,
          version: Platform.Version,
          trigger: trigger || 'unknown',
        },
        appVersion: Application.nativeApplicationVersion ?? undefined,
      });

      void successHaptic();
      toast.success(t('bugReport.success' as TranslationKey));
      Logger.logUserAction('quick_bug_report_submitted', {
        trigger,
        module: selectedModule,
        screenshotCount: screenshots.length,
        hasSubject: subject.trim().length > 0,
      });
      closeBugReport();
    } catch (error) {
      Logger.error('Failed to submit quick bug report', error as Error);
      toast.error(t('bugReport.error' as TranslationKey));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isValid,
    isSubmitting,
    session?.user?.id,
    selectedModule,
    subject,
    message,
    screenshots,
    trigger,
    toast,
    closeBugReport,
    t,
  ]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    void warningHaptic();
    closeBugReport();
  }, [closeBugReport]);

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        index={0}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        onChange={handleSheetChange}
        handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
        backgroundStyle={[styles.sheetBackground, { backgroundColor: colors.background }]}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <BottomSheetScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Ionicons name="bug" size={28} color={status.error.DEFAULT} />
              </View>
              <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
                {t('bugReport.title' as TranslationKey)}
              </Text>
              <Text size="sm" color={colors.textSecondary} style={styles.subtitle}>
                {trigger === 'shake'
                  ? t('bugReport.subtitle' as TranslationKey)
                  : t('bugReport.subtitleMenu' as TranslationKey)}
              </Text>
            </View>

            {/* Module Selection */}
            <View style={styles.moduleSection}>
              <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.label}>
                {t('bugReport.moduleLabel' as TranslationKey)}
              </Text>
              <View style={styles.moduleChips}>
                {QUICK_MODULES.map(mod => {
                  const isActive = selectedModule === mod.value;
                  return (
                    <TouchableOpacity
                      key={mod.value}
                      style={[
                        styles.moduleChip,
                        {
                          backgroundColor: isActive ? colors.chipActive : colors.chipInactive,
                          borderColor: isActive ? colors.chipActive : colors.border,
                        },
                      ]}
                      onPress={() => handleModuleSelect(mod.value)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={mod.icon}
                        size={16}
                        color={isActive ? colors.chipTextActive : colors.chipTextInactive}
                      />
                      <Text
                        size="xs"
                        weight={isActive ? 'semibold' : 'medium'}
                        color={isActive ? colors.chipTextActive : colors.chipTextInactive}
                      >
                        {t(mod.labelKey as TranslationKey)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Subject Input */}
            <View style={styles.inputSection}>
              <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.label}>
                {t('bugReport.subjectLabel' as TranslationKey)}
              </Text>
              <TextInput
                style={[
                  styles.subjectInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.inputText,
                  },
                ]}
                placeholder={t('bugReport.subjectPlaceholder' as TranslationKey)}
                placeholderTextColor={colors.inputPlaceholder}
                value={subject}
                onChangeText={setSubject}
                maxLength={MAX_SUBJECT_LENGTH}
              />
              <Text
                size="xs"
                color={
                  subject.length < MIN_SUBJECT_LENGTH ? status.warning.DEFAULT : colors.textMuted
                }
                style={styles.charCount}
              >
                {subject.length}/{MAX_SUBJECT_LENGTH}
              </Text>
            </View>

            {/* Message Input */}
            <View style={styles.inputSection}>
              <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.label}>
                {t('bugReport.descriptionLabel' as TranslationKey)}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.inputText,
                  },
                ]}
                placeholder={t('bugReport.descriptionPlaceholder' as TranslationKey)}
                placeholderTextColor={colors.inputPlaceholder}
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={4}
                maxLength={MAX_MESSAGE_LENGTH}
                textAlignVertical="top"
              />
              <Text
                size="xs"
                color={
                  message.length < MIN_MESSAGE_LENGTH ? status.warning.DEFAULT : colors.textMuted
                }
                style={styles.charCount}
              >
                {message.length}/{MAX_MESSAGE_LENGTH} • {t('bugReport.minChars' as TranslationKey)}
              </Text>
            </View>

            {/* Screenshots Section */}
            <View style={styles.screenshotsSection}>
              <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.label}>
                {t('feedback.screenshotsLabel' as TranslationKey)}
              </Text>
              <Text size="xs" color={colors.textMuted} style={styles.screenshotsHint}>
                {t('feedback.screenshotsHint' as TranslationKey, { max: MAX_SCREENSHOTS })}
              </Text>

              <View style={styles.screenshotsRow}>
                {screenshots.map((uri, index) => (
                  <View key={uri} style={styles.screenshotContainer}>
                    <Image source={{ uri }} style={styles.screenshotImage} />
                    <TouchableOpacity
                      style={[
                        styles.removeScreenshotBtn,
                        { backgroundColor: status.error.DEFAULT },
                      ]}
                      onPress={() => handleRemoveScreenshot(index)}
                    >
                      <Ionicons name="close" size={14} color={BASE_WHITE} />
                    </TouchableOpacity>
                  </View>
                ))}

                {screenshots.length < MAX_SCREENSHOTS && (
                  <TouchableOpacity
                    style={[
                      styles.addScreenshotBtn,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={handleAddScreenshot}
                    disabled={isUploadingImage}
                  >
                    {isUploadingImage ? (
                      <ActivityIndicator size="small" color={colors.textSecondary} />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={24} color={colors.textSecondary} />
                        <Text size="xs" color={colors.textSecondary}>
                          {t('feedback.addScreenshot' as TranslationKey)}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: colors.border }]}
                onPress={handleCancel}
                activeOpacity={0.7}
              >
                <Text size="sm" weight="medium" color={colors.text}>
                  {t('bugReport.cancel' as TranslationKey)}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.submitButton,
                  {
                    backgroundColor: isValid ? colors.buttonPrimary : colors.buttonDisabled,
                  },
                ]}
                onPress={() => void handleSubmit()}
                disabled={!isValid || isSubmitting}
                activeOpacity={0.7}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={colors.buttonPrimaryText} />
                ) : (
                  <>
                    <Ionicons name="send" size={18} color={colors.buttonPrimaryText} />
                    <Text size="sm" weight="semibold" color={colors.buttonPrimaryText}>
                      {t('bugReport.submit' as TranslationKey)}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </BottomSheetScrollView>
        </KeyboardAvoidingView>
      </BottomSheetModal>

      {/* Image Source Modal */}
      <Modal
        visible={showImageSourceModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowImageSourceModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowImageSourceModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <Text size="lg" weight="bold" color={colors.text} style={styles.modalTitle}>
              {t('feedback.selectImageSource' as TranslationKey)}
            </Text>

            <TouchableOpacity
              style={[styles.modalOption, { backgroundColor: colors.inputBackground }]}
              onPress={() => void handlePickFromCamera()}
            >
              <Ionicons name="camera" size={24} color={colors.text} />
              <Text size="base" color={colors.text}>
                Camera
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalOption, { backgroundColor: colors.inputBackground }]}
              onPress={() => void handlePickFromGallery()}
            >
              <Ionicons name="images" size={24} color={colors.text} />
              <Text size="base" color={colors.text}>
                Gallery
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalCancelBtn, { borderColor: colors.border }]}
              onPress={() => setShowImageSourceModal(false)}
            >
              <Text size="base" color={colors.text}>
                {t('bugReport.cancel' as TranslationKey)}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels.xl,
    borderTopRightRadius: radiusPixels.xl,
  },
  handleIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: spacingPixels[2],
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[6],
    paddingBottom: spacingPixels[8],
  },
  header: {
    alignItems: 'center',
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[6],
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${status.error.DEFAULT}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    textAlign: 'center',
    opacity: 0.8,
  },
  moduleSection: {
    marginBottom: spacingPixels[6],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  moduleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  moduleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  inputSection: {
    marginBottom: spacingPixels[4],
  },
  subjectInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    padding: spacingPixels[3],
    fontSize: 15,
  },
  input: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    padding: spacingPixels[3],
    fontSize: 15,
    minHeight: 80,
  },
  charCount: {
    marginTop: spacingPixels[1],
    textAlign: 'right',
  },
  screenshotsSection: {
    marginBottom: spacingPixels[4],
  },
  screenshotsHint: {
    marginBottom: spacingPixels[2],
  },
  screenshotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  screenshotContainer: {
    position: 'relative',
    width: 70,
    height: 70,
  },
  screenshotImage: {
    width: 70,
    height: 70,
    borderRadius: radiusPixels.md,
  },
  removeScreenshotBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addScreenshotBtn: {
    width: 70,
    height: 70,
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
  },
  actions: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    marginTop: spacingPixels[2],
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[6],
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[6],
  },
  modalTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[2],
  },
  modalCancelBtn: {
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginTop: spacingPixels[2],
  },
});

export default BugReportSheet;
