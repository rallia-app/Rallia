/**
 * Feedback Report Bottom Sheet
 *
 * A unified bottom sheet for all user feedback: value proposition,
 * bug reports, and feature suggestions.
 * Can be triggered via shake gesture, FAB, or settings menu.
 *
 * Styled to match ReportFacilitySheet / ReportIssueSheet design language.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Image,
  TextInput,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { Text, useToast } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import {
  submitUserFeedback,
  Logger,
  type UserFeedbackModule,
  type UserFeedbackCategory,
} from '@rallia/shared-services';
import { lightHaptic, successHaptic, warningHaptic, selectionHaptic } from '@rallia/shared-utils';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  base,
  status,
  secondary,
} from '@rallia/design-system';

import { useAuth, useTranslation, type TranslationKey, useImagePicker } from '../hooks';
import { useFeedbackReportSheet } from '../context/BugReportSheetContext';
import { uploadImage } from '../services/imageUpload';

const MIN_SUBJECT_LENGTH = 3;
const MAX_SUBJECT_LENGTH = 100;
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_SCREENSHOTS = 3;

// =============================================================================
// CATEGORY OPTIONS
// =============================================================================

interface CategoryOption {
  value: UserFeedbackCategory;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    value: 'improvement',
    icon: 'heart-outline',
    labelKey: 'feedback.categories.improvement',
  },
  {
    value: 'bug',
    icon: 'bug-outline',
    labelKey: 'feedback.categories.bug',
  },
  {
    value: 'feature',
    icon: 'bulb-outline',
    labelKey: 'feedback.categories.feature',
  },
];

// =============================================================================
// MODULE OPTIONS
// =============================================================================

interface QuickModuleOption {
  value: UserFeedbackModule;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}

const QUICK_MODULES: QuickModuleOption[] = [
  { value: 'match_features', icon: 'people-outline', labelKey: 'bugReport.modules.matches' },
  { value: 'messaging', icon: 'chatbubble-outline', labelKey: 'bugReport.modules.chat' },
  { value: 'profile_settings', icon: 'person-outline', labelKey: 'bugReport.modules.profile' },
  { value: 'rating_system', icon: 'star-outline', labelKey: 'bugReport.modules.ratingSystem' },
  {
    value: 'player_directory',
    icon: 'search-outline',
    labelKey: 'bugReport.modules.playerDirectory',
  },
  {
    value: 'notifications',
    icon: 'notifications-outline',
    labelKey: 'bugReport.modules.notifications',
  },
  { value: 'performance', icon: 'speedometer-outline', labelKey: 'bugReport.modules.performance' },
  { value: 'other', icon: 'apps-outline', labelKey: 'bugReport.modules.other' },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const FeedbackReportSheet: React.FC = () => {
  const { sheetRef, closeFeedbackReport, onSheetDismiss, trigger } = useFeedbackReportSheet();
  const { theme } = useTheme();
  const { session } = useAuth();
  const { t } = useTranslation();
  const toast = useToast();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const { pickMultipleFromGallery } = useImagePicker({ skipEditing: true });
  const scrollViewRef = useRef<any>(null);

  // Form state — use refs for text values to avoid re-renders on every keystroke
  const subjectRef = useRef('');
  const messageRef = useRef('');
  const subjectInputRef = useRef<TextInput | null>(null);
  const messageInputRef = useRef<TextInput | null>(null);
  const [subjectLength, setSubjectLength] = useState(0);
  const [messageLength, setMessageLength] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<UserFeedbackCategory | null>(null);
  const [selectedModule, setSelectedModule] = useState<UserFeedbackModule | null>(null);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Theme colors — same pattern as ReportFacilitySheet & ReportIssueSheet
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: themeColors.mutedForeground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      muted: themeColors.muted,
      inputBackground: isDark ? neutral[800] : neutral[50],
      buttonActive: secondary[500],
      buttonInactive: themeColors.muted,
      buttonTextActive: base.white,
    }),
    [themeColors, isDark]
  );

  // Validation
  const subjectValid = subjectLength >= MIN_SUBJECT_LENGTH;
  const messageValid = messageLength >= MIN_MESSAGE_LENGTH;
  const isValid =
    subjectValid && messageValid && selectedModule !== null && selectedCategory !== null;

  // Snap points
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
      setTimeout(() => {
        subjectRef.current = '';
        messageRef.current = '';
        subjectInputRef.current?.clear();
        messageInputRef.current?.clear();
        setSubjectLength(0);
        setMessageLength(0);
        setSelectedCategory(null);
        setSelectedModule(null);
        setScreenshots([]);
        setIsSubmitting(false);
      }, 300);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    onSheetDismiss();
  }, [onSheetDismiss]);

  const handleClose = useCallback(() => {
    lightHaptic();
    closeFeedbackReport();
  }, [closeFeedbackReport]);

  // Text input handlers — update ref immediately, length state for UI
  const handleSubjectChange = useCallback((text: string) => {
    subjectRef.current = text;
    setSubjectLength(text.trim().length);
  }, []);

  const handleMessageChange = useCallback((text: string) => {
    messageRef.current = text;
    setMessageLength(text.trim().length);
  }, []);

  // Handle category selection
  const handleCategorySelect = useCallback((cat: UserFeedbackCategory) => {
    selectionHaptic();
    setSelectedCategory(cat);
  }, []);

  // Handle module selection
  const handleModuleSelect = useCallback((mod: UserFeedbackModule | null) => {
    selectionHaptic();
    setSelectedModule(mod);
  }, []);

  // Handle add screenshot — directly opens gallery with multi-select, stores local URIs
  const handleAddScreenshot = useCallback(async () => {
    const remaining = MAX_SCREENSHOTS - screenshots.length;
    if (remaining <= 0) {
      toast.error(t('feedback.maxScreenshotsReached' as TranslationKey, { max: MAX_SCREENSHOTS }));
      return;
    }

    try {
      const result = await pickMultipleFromGallery(remaining);
      if (result.uris.length > 0) {
        setScreenshots(prev => [...prev, ...result.uris]);
        void lightHaptic();
      }
    } catch (error) {
      Logger.error('Failed to pick screenshots from gallery', error as Error);
    }
  }, [screenshots.length, pickMultipleFromGallery, toast, t]);

  // Handle remove screenshot
  const handleRemoveScreenshot = useCallback((index: number) => {
    void warningHaptic();
    setScreenshots(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Handle submit — uploads screenshots then submits feedback
  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;

    void lightHaptic();
    setIsSubmitting(true);

    try {
      // Upload screenshots at submit time
      let screenshotUrls: string[] | undefined;
      if (screenshots.length > 0) {
        const uploadedUrls: string[] = [];
        for (const uri of screenshots) {
          const uploadResult = await uploadImage(uri, 'feedback-screenshots', session?.user?.id);
          if (uploadResult.url) {
            uploadedUrls.push(uploadResult.url);
          }
        }
        if (uploadedUrls.length > 0) {
          screenshotUrls = uploadedUrls;
        }
      }

      await submitUserFeedback({
        playerId: session?.user?.id,
        category: selectedCategory!,
        module: selectedModule!,
        subject: subjectRef.current.trim(),
        message: messageRef.current.trim(),
        screenshotUrls,
        deviceInfo: {
          platform: Platform.OS,
          version: Platform.Version,
          trigger: trigger || 'unknown',
        },
        appVersion: Application.nativeApplicationVersion ?? undefined,
      });

      void successHaptic();
      toast.success(t('bugReport.success' as TranslationKey));
      Logger.logUserAction('feedback_report_submitted', {
        trigger,
        category: selectedCategory,
        module: selectedModule,
        screenshotCount: screenshots.length,
        hasSubject: subjectRef.current.trim().length > 0,
      });
      closeFeedbackReport();
    } catch (error) {
      Logger.error('Failed to submit feedback report', error as Error);
      toast.error(t('bugReport.error' as TranslationKey));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isValid,
    isSubmitting,
    session?.user?.id,
    selectedCategory,
    selectedModule,
    screenshots,
    trigger,
    toast,
    closeFeedbackReport,
    t,
  ]);

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
        onDismiss={handleDismiss}
        handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
        backgroundStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        {/* Header — matches ReportFacilitySheet badge + close button pattern */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.badge, { backgroundColor: secondary[500] }]}>
            <Ionicons name="chatbox-ellipses-outline" size={14} color={base.white} />
            <Text size="sm" weight="semibold" color={base.white}>
              {t('feedback.sheetTitle' as TranslationKey)}
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable content */}
        <BottomSheetScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Subtitle */}
          <Text size="sm" color={colors.textSecondary} style={styles.subtitle}>
            {trigger === 'shake'
              ? t('bugReport.subtitle' as TranslationKey)
              : t('feedback.description' as TranslationKey)}
          </Text>

          {/* Category Selection — card-based like module cards */}
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              {t('feedback.categoryLabel' as TranslationKey)}
            </Text>
            <View style={styles.moduleCards}>
              {CATEGORY_OPTIONS.map(cat => {
                const isActive = selectedCategory === cat.value;
                return (
                  <TouchableOpacity
                    key={cat.value}
                    style={[
                      styles.moduleCard,
                      {
                        backgroundColor: isActive
                          ? `${colors.buttonActive}15`
                          : colors.buttonInactive,
                        borderColor: isActive ? colors.buttonActive : colors.border,
                      },
                    ]}
                    onPress={() => handleCategorySelect(cat.value)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.moduleIconContainer,
                        {
                          backgroundColor: isActive ? colors.buttonActive : colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={cat.icon}
                        size={18}
                        color={isActive ? colors.buttonTextActive : colors.textMuted}
                      />
                    </View>
                    <Text
                      size="sm"
                      weight={isActive ? 'semibold' : 'regular'}
                      color={isActive ? colors.buttonActive : colors.text}
                      style={styles.moduleLabel}
                    >
                      {t(cat.labelKey as TranslationKey)}
                    </Text>
                    {isActive && (
                      <Ionicons name="checkmark-circle" size={18} color={colors.buttonActive} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Module Selection — card-based like ReportFacilitySheet reasons */}
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              {t('bugReport.moduleLabel' as TranslationKey)}
            </Text>
            <View style={styles.moduleCards}>
              {QUICK_MODULES.map(mod => {
                const isActive = selectedModule === mod.value;
                return (
                  <TouchableOpacity
                    key={mod.value}
                    style={[
                      styles.moduleCard,
                      {
                        backgroundColor: isActive
                          ? `${colors.buttonActive}15`
                          : colors.buttonInactive,
                        borderColor: isActive ? colors.buttonActive : colors.border,
                      },
                    ]}
                    onPress={() => handleModuleSelect(mod.value)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.moduleIconContainer,
                        {
                          backgroundColor: isActive ? colors.buttonActive : colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={mod.icon}
                        size={18}
                        color={isActive ? colors.buttonTextActive : colors.textMuted}
                      />
                    </View>
                    <Text
                      size="sm"
                      weight={isActive ? 'semibold' : 'regular'}
                      color={isActive ? colors.buttonActive : colors.text}
                      style={styles.moduleLabel}
                    >
                      {t(mod.labelKey as TranslationKey)}
                    </Text>
                    {isActive && (
                      <Ionicons name="checkmark-circle" size={18} color={colors.buttonActive} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Subject Input */}
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              {t('bugReport.subjectLabel' as TranslationKey)}
            </Text>
            <BottomSheetTextInput
              ref={subjectInputRef as any}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder={t('bugReport.subjectPlaceholder' as TranslationKey)}
              placeholderTextColor={colors.textMuted}
              onChangeText={handleSubjectChange}
              maxLength={MAX_SUBJECT_LENGTH}
            />
            <Text
              size="xs"
              color={subjectLength < MIN_SUBJECT_LENGTH ? status.warning.DEFAULT : colors.textMuted}
              style={styles.characterCount}
            >
              {subjectLength}/{MAX_SUBJECT_LENGTH}
            </Text>
          </View>

          {/* Message Input */}
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              {t('bugReport.descriptionLabel' as TranslationKey)}
            </Text>
            <BottomSheetTextInput
              ref={messageInputRef as any}
              style={[
                styles.textInput,
                styles.multilineInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder={t('bugReport.descriptionPlaceholder' as TranslationKey)}
              placeholderTextColor={colors.textMuted}
              onChangeText={handleMessageChange}
              multiline
              numberOfLines={4}
              maxLength={MAX_MESSAGE_LENGTH}
              textAlignVertical="top"
            />
            <Text
              size="xs"
              color={messageLength < MIN_MESSAGE_LENGTH ? status.warning.DEFAULT : colors.textMuted}
              style={styles.characterCount}
            >
              {messageLength}/{MAX_MESSAGE_LENGTH} • {t('bugReport.minChars' as TranslationKey)}
            </Text>
          </View>

          {/* Screenshots Section */}
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              {t('feedback.screenshotsLabel' as TranslationKey)}
            </Text>

            <View
              style={[
                styles.screenshotCard,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.screenshotCardHeader}>
                <Ionicons name="images-outline" size={18} color={colors.textSecondary} />
                <Text size="xs" color={colors.textSecondary} style={styles.screenshotHintText}>
                  {t('feedback.screenshotsHint' as TranslationKey, { max: MAX_SCREENSHOTS })}
                </Text>
              </View>

              <View style={styles.screenshotGrid}>
                {screenshots.map((uri, index) => (
                  <View key={uri} style={styles.screenshotContainer}>
                    <Image source={{ uri }} style={styles.screenshotImage} />
                    <TouchableOpacity
                      style={[
                        styles.removeScreenshotBtn,
                        { backgroundColor: status.error.DEFAULT },
                      ]}
                      onPress={() => handleRemoveScreenshot(index)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close" size={14} color={base.white} />
                    </TouchableOpacity>
                  </View>
                ))}

                {screenshots.length < MAX_SCREENSHOTS && (
                  <TouchableOpacity
                    style={[
                      styles.addScreenshotBtn,
                      {
                        backgroundColor: colors.cardBackground,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => void handleAddScreenshot()}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.addScreenshotIcon, { backgroundColor: colors.border }]}>
                      <Ionicons name="images-outline" size={22} color={colors.textSecondary} />
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </BottomSheetScrollView>

        {/* Footer — matches ReportFacilitySheet / ReportIssueSheet footer */}
        <View
          style={[
            styles.footer,
            { borderTopColor: colors.border, paddingBottom: insets.bottom + spacingPixels[4] },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor: isValid ? colors.buttonActive : colors.buttonInactive,
              },
              isSubmitting && styles.buttonDisabled,
            ]}
            onPress={() => void handleSubmit()}
            disabled={!isValid || isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.buttonTextActive} />
            ) : (
              <>
                <Text
                  size="lg"
                  weight="semibold"
                  color={isValid ? colors.buttonTextActive : colors.textMuted}
                >
                  {t('feedback.submitButton' as TranslationKey)}
                </Text>
                <Ionicons
                  name="paper-plane-outline"
                  size={18}
                  color={isValid ? colors.buttonTextActive : colors.textMuted}
                />
              </>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheetModal>
    </>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
  },

  // Header — mirrors ReportFacilitySheet header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1.5],
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    padding: spacingPixels[1],
  },

  // Content
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  subtitle: {
    marginBottom: spacingPixels[4],
  },
  section: {
    marginBottom: spacingPixels[6],
  },
  sectionLabel: {
    marginBottom: spacingPixels[3],
  },

  // Module cards — matches ReportFacilitySheet reason cards
  moduleCards: {
    gap: spacingPixels[2],
  },
  moduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  moduleIconContainer: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleLabel: {
    flex: 1,
  },

  // Inputs
  textInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  characterCount: {
    textAlign: 'right',
    marginTop: spacingPixels[1],
  },

  // Screenshots
  screenshotCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
  },
  screenshotCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  screenshotHintText: {
    flex: 1,
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
  removeScreenshotBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addScreenshotBtn: {
    width: 100,
    height: 100,
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    gap: spacingPixels[1.5],
  },
  addScreenshotIcon: {
    width: 48,
    height: 48,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Footer — matches ReportFacilitySheet / ReportIssueSheet footer
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default FeedbackReportSheet;
