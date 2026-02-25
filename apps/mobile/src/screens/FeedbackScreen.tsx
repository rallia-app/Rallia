/**
 * Feedback Screen
 * Allows users to submit feedback, bug reports, and suggestions
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { submitUserFeedback, UserFeedbackCategory, Logger } from '@rallia/shared-services';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useAuth, useTranslation, type TranslationKey, useImagePicker } from '../hooks';
import { useAppNavigation } from '../navigation/hooks';
import { uploadImage } from '../services/imageUpload';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';

const BASE_WHITE = '#ffffff';

// Validation constants
const MIN_SUBJECT_LENGTH = 3;
const MAX_SUBJECT_LENGTH = 100;
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_SCREENSHOTS = 3;

interface CategoryOption {
  value: UserFeedbackCategory;
  icon: keyof typeof Ionicons.glyphMap;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'bug', icon: 'bug-outline' },
  { value: 'feature', icon: 'bulb-outline' },
  { value: 'improvement', icon: 'trending-up-outline' },
  { value: 'other', icon: 'chatbox-ellipses-outline' },
];

const FeedbackScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const toast = useToast();
  const { t } = useTranslation();
  const { session } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { pickFromGallery, pickFromCamera } = useImagePicker();

  // Form state
  const [category, setCategory] = useState<UserFeedbackCategory>('feature');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [submittedFeedbackId, setSubmittedFeedbackId] = useState<string | null>(null);
  const [showImageSourceModal, setShowImageSourceModal] = useState(false);

  // Theme-aware colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      inputBackground: isDark ? neutral[800] : neutral[50],
      inputBorder: themeColors.border,
      inputBorderFocus: isDark ? primary[500] : primary[600],
      inputText: themeColors.foreground,
      inputPlaceholder: themeColors.mutedForeground,
      buttonPrimary: isDark ? primary[500] : primary[600],
      buttonPrimaryText: BASE_WHITE,
      buttonDisabled: themeColors.muted,
      buttonDisabledText: themeColors.mutedForeground,
      categoryActive: isDark ? primary[500] : primary[600],
      categoryInactive: themeColors.muted,
      categoryTextActive: BASE_WHITE,
      categoryTextInactive: themeColors.foreground,
      success: status.success.DEFAULT,
      successLight: isDark ? `${status.success.DEFAULT}30` : `${status.success.light}20`,
      error: status.error.DEFAULT,
      errorLight: isDark ? `${status.error.DEFAULT}20` : `${status.error.light}15`,
      modalOverlay: 'rgba(0, 0, 0, 0.5)',
    }),
    [themeColors, isDark]
  );

  // Form validation
  const subjectValid = subject.trim().length >= MIN_SUBJECT_LENGTH;
  const messageValid = message.trim().length >= MIN_MESSAGE_LENGTH;
  const isFormValid = subjectValid && messageValid;

  // Character count colors
  const getCharCountColor = useCallback((current: number, min: number, max: number) => {
    if (current < min) return status.warning.DEFAULT;
    if (current > max * 0.9) return status.warning.DEFAULT;
    return colors.textMuted;
  }, [colors.textMuted]);

  const handleCategorySelect = (cat: UserFeedbackCategory) => {
    lightHaptic();
    setCategory(cat);
    // Clear screenshots when switching away from bug report
    if (cat !== 'bug' && screenshots.length > 0) {
      setScreenshots([]);
    }
  };

  const handleAddScreenshot = async () => {
    if (screenshots.length >= MAX_SCREENSHOTS) {
      toast.error(t('feedback.maxScreenshotsReached' as TranslationKey, { max: MAX_SCREENSHOTS }));
      return;
    }
    setShowImageSourceModal(true);
  };

  const handlePickFromGallery = async () => {
    setShowImageSourceModal(false);
    setIsUploadingImage(true);
    
    try {
      const result = await pickFromGallery();
      if (result.uri) {
        // Upload to Supabase Storage
        const uploadResult = await uploadImage(result.uri, 'feedback-screenshots', session?.user?.id);
        if (uploadResult.url) {
          setScreenshots(prev => [...prev, uploadResult.url!]);
          lightHaptic();
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
  };

  const handlePickFromCamera = async () => {
    setShowImageSourceModal(false);
    setIsUploadingImage(true);
    
    try {
      const result = await pickFromCamera();
      if (result.uri) {
        // Upload to Supabase Storage
        const uploadResult = await uploadImage(result.uri, 'feedback-screenshots', session?.user?.id);
        if (uploadResult.url) {
          setScreenshots(prev => [...prev, uploadResult.url!]);
          lightHaptic();
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
  };

  const handleRemoveScreenshot = (index: number) => {
    warningHaptic();
    setScreenshots(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!isFormValid || isSubmitting) return;

    lightHaptic();
    setIsSubmitting(true);

    try {
      const result = await submitUserFeedback({
        playerId: session?.user?.id,
        category,
        subject: subject.trim(),
        message: message.trim(),
        screenshotUrls: category === 'bug' ? screenshots : undefined,
      });

      successHaptic();
      setSubmittedFeedbackId(result.id);
      setShowSuccessModal(true);
      Logger.logUserAction('feedback_submitted', { category, screenshotCount: screenshots.length });
    } catch (error) {
      Logger.error('Failed to submit feedback', error as Error);
      toast.error(t('feedback.submitError' as TranslationKey));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuccessClose = () => {
    setShowSuccessModal(false);
    navigation.goBack();
  };

  const handleSubmitAnother = () => {
    setShowSuccessModal(false);
    setSubject('');
    setMessage('');
    setScreenshots([]);
    setCategory('feature');
    setSubmittedFeedbackId(null);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <ScrollView
          style={[styles.scrollContent, { backgroundColor: colors.cardBackground }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header Description */}
          <View style={styles.headerSection}>
            <Text size="sm" color={colors.textSecondary} style={styles.headerDescription}>
              {t('feedback.description' as TranslationKey)}
            </Text>
          </View>

          {/* Category Selection */}
          <View style={styles.section}>
            <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.sectionLabel}>
              {t('feedback.categoryLabel' as TranslationKey)}
            </Text>
            <View style={styles.categoryGrid}>
              {CATEGORY_OPTIONS.map((option) => {
                const isActive = category === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.categoryButton,
                      {
                        backgroundColor: isActive
                          ? colors.categoryActive
                          : colors.categoryInactive,
                        borderColor: isActive
                          ? colors.categoryActive
                          : colors.border,
                      },
                    ]}
                    onPress={() => handleCategorySelect(option.value)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={option.icon}
                      size={20}
                      color={isActive ? colors.categoryTextActive : colors.categoryTextInactive}
                    />
                    <Text
                      size="xs"
                      weight={isActive ? 'semibold' : 'medium'}
                      color={isActive ? colors.categoryTextActive : colors.categoryTextInactive}
                    >
                      {t(`feedback.categories.${option.value}` as TranslationKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Subject Input */}
          <View style={styles.section}>
            <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.sectionLabel}>
              {t('feedback.subjectLabel' as TranslationKey)} *
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
              value={subject}
              onChangeText={setSubject}
              placeholder={t('feedback.subjectPlaceholder' as TranslationKey)}
              placeholderTextColor={colors.inputPlaceholder}
              maxLength={MAX_SUBJECT_LENGTH}
              returnKeyType="next"
            />
            <View style={styles.inputFooter}>
              {subject.length > 0 && subject.length < MIN_SUBJECT_LENGTH && (
                <Text size="xs" color={status.warning.DEFAULT}>
                  {t('feedback.minCharsHint' as TranslationKey, { min: MIN_SUBJECT_LENGTH })}
                </Text>
              )}
              <Text 
                size="xs" 
                color={getCharCountColor(subject.length, MIN_SUBJECT_LENGTH, MAX_SUBJECT_LENGTH)} 
                style={styles.charCount}
              >
                {subject.length}/{MAX_SUBJECT_LENGTH}
              </Text>
            </View>
          </View>

          {/* Message Input */}
          <View style={styles.section}>
            <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.sectionLabel}>
              {t('feedback.messageLabel' as TranslationKey)} *
            </Text>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.inputText,
                },
              ]}
              value={message}
              onChangeText={setMessage}
              placeholder={t('feedback.messagePlaceholder' as TranslationKey)}
              placeholderTextColor={colors.inputPlaceholder}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={MAX_MESSAGE_LENGTH}
            />
            <View style={styles.inputFooter}>
              {message.length > 0 && message.length < MIN_MESSAGE_LENGTH && (
                <Text size="xs" color={status.warning.DEFAULT}>
                  {t('feedback.minCharsHint' as TranslationKey, { min: MIN_MESSAGE_LENGTH })}
                </Text>
              )}
              <Text 
                size="xs" 
                color={getCharCountColor(message.length, MIN_MESSAGE_LENGTH, MAX_MESSAGE_LENGTH)} 
                style={styles.charCount}
              >
                {message.length}/{MAX_MESSAGE_LENGTH}
              </Text>
            </View>
          </View>

          {/* Screenshot Section - Only for Bug Reports */}
          {category === 'bug' && (
            <View style={styles.section}>
              <Text size="sm" weight="medium" color={colors.textSecondary} style={styles.sectionLabel}>
                {t('feedback.screenshotsLabel' as TranslationKey)}
              </Text>
              <Text size="xs" color={colors.textMuted} style={styles.screenshotHint}>
                {t('feedback.screenshotsHint' as TranslationKey, { max: MAX_SCREENSHOTS })}
              </Text>
              
              <View style={styles.screenshotGrid}>
                {/* Existing Screenshots */}
                {screenshots.map((uri, index) => (
                  <View key={uri} style={styles.screenshotContainer}>
                    <Image source={{ uri }} style={styles.screenshotImage} />
                    <TouchableOpacity
                      style={[styles.removeScreenshotButton, { backgroundColor: colors.error }]}
                      onPress={() => handleRemoveScreenshot(index)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close" size={14} color={BASE_WHITE} />
                    </TouchableOpacity>
                  </View>
                ))}
                
                {/* Add Screenshot Button */}
                {screenshots.length < MAX_SCREENSHOTS && (
                  <TouchableOpacity
                    style={[
                      styles.addScreenshotButton,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.inputBorder,
                      },
                    ]}
                    onPress={handleAddScreenshot}
                    disabled={isUploadingImage}
                    activeOpacity={0.7}
                  >
                    {isUploadingImage ? (
                      <ActivityIndicator size="small" color={colors.buttonPrimary} />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={24} color={colors.textMuted} />
                        <Text size="xs" color={colors.textMuted}>
                          {t('feedback.addScreenshot' as TranslationKey)}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* User Notice */}
          <View style={[styles.noticeBox, { backgroundColor: colors.inputBackground }]}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
            <Text size="xs" color={colors.textMuted} style={styles.noticeText}>
              {session?.user 
                ? t('feedback.identifiedNotice' as TranslationKey)
                : t('feedback.anonymousNotice' as TranslationKey)
              }
            </Text>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor: isFormValid && !isSubmitting
                  ? colors.buttonPrimary
                  : colors.buttonDisabled,
              },
            ]}
            onPress={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            activeOpacity={0.7}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.buttonPrimaryText} />
            ) : (
              <>
                <Ionicons
                  name="send-outline"
                  size={18}
                  color={isFormValid ? colors.buttonPrimaryText : colors.buttonDisabledText}
                />
                <Text
                  size="base"
                  weight="semibold"
                  color={isFormValid ? colors.buttonPrimaryText : colors.buttonDisabledText}
                >
                  {t('feedback.submitButton' as TranslationKey)}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={handleSuccessClose}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.cardBackground }]}>
            {/* Success Icon */}
            <View style={[styles.successIconContainer, { backgroundColor: colors.successLight }]}>
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
            </View>

            {/* Title */}
            <Text size="xl" weight="bold" color={colors.text} style={styles.modalTitle}>
              {t('feedback.successTitle' as TranslationKey)}
            </Text>

            {/* Message */}
            <Text size="sm" color={colors.textSecondary} style={styles.modalMessage}>
              {t('feedback.successMessage' as TranslationKey)}
            </Text>

            {/* Feedback ID */}
            {submittedFeedbackId && (
              <View style={[styles.feedbackIdBox, { backgroundColor: colors.inputBackground }]}>
                <Text size="xs" color={colors.textMuted}>
                  {t('feedback.referenceId' as TranslationKey)}
                </Text>
                <Text size="xs" weight="medium" color={colors.text} style={styles.feedbackIdText}>
                  {submittedFeedbackId.slice(0, 8).toUpperCase()}
                </Text>
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButtonSecondary, { borderColor: colors.border }]}
                onPress={handleSubmitAnother}
                activeOpacity={0.7}
              >
                <Text size="sm" weight="medium" color={colors.text}>
                  {t('feedback.submitAnother' as TranslationKey)}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButtonPrimary, { backgroundColor: colors.buttonPrimary }]}
                onPress={handleSuccessClose}
                activeOpacity={0.7}
              >
                <Text size="sm" weight="semibold" color={colors.buttonPrimaryText}>
                  {t('common.done')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Image Source Selection Modal */}
      <Modal
        visible={showImageSourceModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowImageSourceModal(false)}
      >
        <TouchableOpacity
          style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}
          activeOpacity={1}
          onPress={() => setShowImageSourceModal(false)}
        >
          <View style={[styles.imageSourceModal, { backgroundColor: colors.cardBackground }]}>
            <Text size="lg" weight="semibold" color={colors.text} style={styles.imageSourceTitle}>
              {t('feedback.selectImageSource' as TranslationKey)}
            </Text>
            
            <TouchableOpacity
              style={[styles.imageSourceOption, { borderBottomColor: colors.border }]}
              onPress={handlePickFromCamera}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={24} color={colors.buttonPrimary} />
              <Text size="base" color={colors.text}>
                {t('profile.takePhoto')}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.imageSourceOption}
              onPress={handlePickFromGallery}
              activeOpacity={0.7}
            >
              <Ionicons name="images-outline" size={24} color={colors.buttonPrimary} />
              <Text size="base" color={colors.text}>
                {t('profile.chooseFromGallery')}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.imageSourceCancel, { backgroundColor: colors.inputBackground }]}
              onPress={() => setShowImageSourceModal(false)}
              activeOpacity={0.7}
            >
              <Text size="base" weight="medium" color={colors.text}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[5],
  },
  headerSection: {
    marginBottom: spacingPixels[5],
  },
  headerDescription: {
    lineHeight: 20,
  },
  section: {
    marginBottom: spacingPixels[5],
  },
  sectionLabel: {
    marginBottom: spacingPixels[2],
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[1.5],
  },
  input: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    fontSize: 16,
  },
  textArea: {
    minHeight: 150,
    paddingTop: spacingPixels[3],
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacingPixels[1],
  },
  charCount: {
    marginLeft: 'auto',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[5],
    gap: spacingPixels[2],
  },
  noticeText: {
    flex: 1,
    lineHeight: 18,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  bottomSpacer: {
    height: spacingPixels[10],
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[6],
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[6],
    alignItems: 'center',
  },
  successIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  modalTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  modalMessage: {
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacingPixels[4],
  },
  feedbackIdBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.md,
    gap: spacingPixels[2],
    marginBottom: spacingPixels[5],
  },
  feedbackIdText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    width: '100%',
  },
  modalButtonSecondary: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalButtonPrimary: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
  },
  // Screenshot styles
  screenshotHint: {
    marginBottom: spacingPixels[3],
  },
  screenshotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[3],
  },
  screenshotContainer: {
    position: 'relative',
    width: 100,
    height: 100,
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  screenshotImage: {
    width: '100%',
    height: '100%',
  },
  removeScreenshotButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addScreenshotButton: {
    width: 100,
    height: 100,
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  // Image source modal styles
  imageSourceModal: {
    width: '100%',
    maxWidth: 320,
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
  },
  imageSourceTitle: {
    textAlign: 'center',
    paddingVertical: spacingPixels[4],
  },
  imageSourceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
    borderBottomWidth: 1,
    gap: spacingPixels[3],
  },
  imageSourceCancel: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
    marginTop: spacingPixels[2],
  },
});

export default FeedbackScreen;
