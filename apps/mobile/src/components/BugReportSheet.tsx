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
  type UserFeedbackMetadata,
  type BugFeedbackMetadata,
  type FeatureFeedbackMetadata,
  type ImprovementFeedbackMetadata,
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

const MIN_TEXT_LENGTH = 3;
const MAX_TEXT_LENGTH = 2000;
const MAX_SCREENSHOTS = 3;

type BugSeverity = BugFeedbackMetadata['severity'];
type DisappointmentScore = ImprovementFeedbackMetadata['disappointment_score'];

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
  { value: 'profile_settings', icon: 'person-outline', labelKey: 'bugReport.modules.profile' },
  { value: 'match_features', icon: 'people-outline', labelKey: 'bugReport.modules.matches' },
  { value: 'facilities', icon: 'location-outline', labelKey: 'bugReport.modules.facilities' },
  {
    value: 'player_directory',
    icon: 'search-outline',
    labelKey: 'bugReport.modules.playerDirectory',
  },
  {
    value: 'groups_communities',
    icon: 'globe-outline',
    labelKey: 'bugReport.modules.groupsCommunities',
  },
  {
    value: 'notifications',
    icon: 'notifications-outline',
    labelKey: 'bugReport.modules.notifications',
  },
  { value: 'performance', icon: 'speedometer-outline', labelKey: 'bugReport.modules.performance' },
  { value: 'other', icon: 'apps-outline', labelKey: 'bugReport.modules.other' },
];

// Severity options for bug reports
const SEVERITY_OPTIONS: { value: BugSeverity; labelKey: string; color: string }[] = [
  { value: 'minor', labelKey: 'feedback.bug.severityMinor', color: '#F59E0B' },
  { value: 'major', labelKey: 'feedback.bug.severityMajor', color: '#F97316' },
  { value: 'critical', labelKey: 'feedback.bug.severityCritical', color: '#EF4444' },
];

// Disappointment options for PMF
const DISAPPOINTMENT_OPTIONS: {
  value: DisappointmentScore;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'very_disappointed', labelKey: 'feedback.pmf.veryDisappointed', icon: 'sad-outline' },
  {
    value: 'somewhat_disappointed',
    labelKey: 'feedback.pmf.somewhatDisappointed',
    icon: 'happy-outline',
  },
  {
    value: 'not_disappointed',
    labelKey: 'feedback.pmf.notDisappointed',
    icon: 'remove-circle-outline',
  },
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

  // Shared state
  const [selectedCategory, setSelectedCategory] = useState<UserFeedbackCategory | null>(null);
  const [selectedModule, setSelectedModule] = useState<UserFeedbackModule | null>(null);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bug-specific state
  const [severity, setSeverity] = useState<BugSeverity | null>(null);
  const stepsRef = useRef('');
  const expectedRef = useRef('');
  const stepsInputRef = useRef<TextInput | null>(null);
  const expectedInputRef = useRef<TextInput | null>(null);
  const [stepsLength, setStepsLength] = useState(0);
  const [expectedLength, setExpectedLength] = useState(0);

  // Feature-specific state
  const featureTitleRef = useRef('');
  const featureDescRef = useRef('');
  const useCaseRef = useRef('');
  const featureTitleInputRef = useRef<TextInput | null>(null);
  const featureDescInputRef = useRef<TextInput | null>(null);
  const useCaseInputRef = useRef<TextInput | null>(null);
  const [featureTitleLength, setFeatureTitleLength] = useState(0);
  const [featureDescLength, setFeatureDescLength] = useState(0);
  const [useCaseLength, setUseCaseLength] = useState(0);

  // PMF/Improvement-specific state
  const [disappointment, setDisappointment] = useState<DisappointmentScore | null>(null);
  const mainBenefitRef = useRef('');
  const idealUserRef = useRef('');
  const improveRef = useRef('');
  const mainBenefitInputRef = useRef<TextInput | null>(null);
  const idealUserInputRef = useRef<TextInput | null>(null);
  const improveInputRef = useRef<TextInput | null>(null);
  const [mainBenefitLength, setMainBenefitLength] = useState(0);
  const [idealUserLength, setIdealUserLength] = useState(0);
  const [improveLength, setImproveLength] = useState(0);

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

  // Category-specific validation — requires signed-in user
  const isValid = useMemo(() => {
    if (!selectedCategory || !session?.user?.id) return false;

    switch (selectedCategory) {
      case 'bug':
        return (
          selectedModule !== null &&
          severity !== null &&
          stepsLength >= MIN_TEXT_LENGTH &&
          expectedLength >= MIN_TEXT_LENGTH
        );
      case 'feature':
        return (
          selectedModule !== null &&
          featureTitleLength >= MIN_TEXT_LENGTH &&
          featureDescLength >= MIN_TEXT_LENGTH &&
          useCaseLength >= MIN_TEXT_LENGTH
        );
      case 'improvement':
        return (
          disappointment !== null &&
          mainBenefitLength >= MIN_TEXT_LENGTH &&
          idealUserLength >= MIN_TEXT_LENGTH &&
          improveLength >= MIN_TEXT_LENGTH
        );
      default:
        return false;
    }
  }, [
    selectedCategory,
    selectedModule,
    severity,
    stepsLength,
    expectedLength,
    featureTitleLength,
    featureDescLength,
    useCaseLength,
    disappointment,
    mainBenefitLength,
    idealUserLength,
    improveLength,
  ]);

  // Snap points
  const snapPoints = useMemo(() => ['90%'], []);

  // Backdrop
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    []
  );

  // Reset all category-specific fields
  const resetCategoryFields = useCallback(() => {
    // Bug
    setSeverity(null);
    stepsRef.current = '';
    expectedRef.current = '';
    stepsInputRef.current?.clear();
    expectedInputRef.current?.clear();
    setStepsLength(0);
    setExpectedLength(0);
    // Feature
    featureTitleRef.current = '';
    featureDescRef.current = '';
    useCaseRef.current = '';
    featureTitleInputRef.current?.clear();
    featureDescInputRef.current?.clear();
    useCaseInputRef.current?.clear();
    setFeatureTitleLength(0);
    setFeatureDescLength(0);
    setUseCaseLength(0);
    // PMF
    setDisappointment(null);
    mainBenefitRef.current = '';
    idealUserRef.current = '';
    improveRef.current = '';
    mainBenefitInputRef.current?.clear();
    idealUserInputRef.current?.clear();
    improveInputRef.current?.clear();
    setMainBenefitLength(0);
    setIdealUserLength(0);
    setImproveLength(0);
  }, []);

  // Reset form when sheet closes
  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        setTimeout(() => {
          setSelectedCategory(null);
          setSelectedModule(null);
          setScreenshots([]);
          setIsSubmitting(false);
          resetCategoryFields();
        }, 300);
      }
    },
    [resetCategoryFields]
  );

  const handleDismiss = useCallback(() => {
    onSheetDismiss();
  }, [onSheetDismiss]);

  const handleClose = useCallback(() => {
    lightHaptic();
    closeFeedbackReport();
  }, [closeFeedbackReport]);

  // Handle category selection — reset fields when switching
  const handleCategorySelect = useCallback(
    (cat: UserFeedbackCategory) => {
      selectionHaptic();
      if (cat !== selectedCategory) {
        resetCategoryFields();
        setSelectedModule(null);
        setScreenshots([]);
      }
      setSelectedCategory(cat);
    },
    [selectedCategory, resetCategoryFields]
  );

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

  // Build metadata based on category
  const buildMetadata = useCallback((): UserFeedbackMetadata | undefined => {
    switch (selectedCategory) {
      case 'bug':
        return {
          severity: severity!,
          steps_to_reproduce: stepsRef.current.trim(),
          expected_vs_actual: expectedRef.current.trim(),
        } as BugFeedbackMetadata;
      case 'feature':
        return {
          feature_title: featureTitleRef.current.trim(),
          description: featureDescRef.current.trim(),
          use_case: useCaseRef.current.trim(),
        } as FeatureFeedbackMetadata;
      case 'improvement':
        return {
          disappointment_score: disappointment!,
          main_benefit: mainBenefitRef.current.trim(),
          ideal_user: idealUserRef.current.trim(),
          how_to_improve: improveRef.current.trim(),
        } as ImprovementFeedbackMetadata;
      default:
        return undefined;
    }
  }, [selectedCategory, severity, disappointment]);

  // Build subject/message from category-specific fields for backward compat
  const buildSubjectAndMessage = useCallback((): { subject: string; message: string } => {
    switch (selectedCategory) {
      case 'bug':
        return {
          subject: `[${severity}] Bug Report`,
          message: `Steps: ${stepsRef.current.trim()}\n\nExpected vs Actual: ${expectedRef.current.trim()}`,
        };
      case 'feature':
        return {
          subject: featureTitleRef.current.trim(),
          message: `${featureDescRef.current.trim()}\n\nUse case: ${useCaseRef.current.trim()}`,
        };
      case 'improvement':
        return {
          subject: `PMF Survey — ${disappointment}`,
          message: `Benefit: ${mainBenefitRef.current.trim()}\nIdeal user: ${idealUserRef.current.trim()}\nImprove: ${improveRef.current.trim()}`,
        };
      default:
        return { subject: '', message: '' };
    }
  }, [selectedCategory, severity, disappointment]);

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

      const { subject, message } = buildSubjectAndMessage();
      const metadata = buildMetadata();

      await submitUserFeedback({
        playerId: session?.user?.id,
        category: selectedCategory!,
        module: selectedModule ?? undefined,
        subject,
        message,
        metadata,
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
    buildSubjectAndMessage,
    buildMetadata,
  ]);

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const renderModuleSelector = () => (
    <View style={styles.section}>
      <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
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
                  backgroundColor: isActive ? `${colors.buttonActive}15` : colors.buttonInactive,
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
  );

  const renderScreenshotsSection = () => (
    <View style={styles.section}>
      <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
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
                style={[styles.removeScreenshotBtn, { backgroundColor: status.error.DEFAULT }]}
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
  );

  const renderTextInput = (opts: {
    label: string;
    placeholder: string;
    inputRef: React.RefObject<TextInput | null>;
    onChange: (text: string) => void;
    currentLength: number;
    multiline?: boolean;
    maxLength?: number;
  }) => (
    <View style={styles.section}>
      <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
        {opts.label}
      </Text>
      <BottomSheetTextInput
        ref={opts.inputRef as any}
        style={[
          styles.textInput,
          opts.multiline !== false && styles.multilineInput,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        placeholder={opts.placeholder}
        placeholderTextColor={colors.textMuted}
        onChangeText={opts.onChange}
        multiline={opts.multiline !== false}
        numberOfLines={opts.multiline !== false ? 4 : 1}
        maxLength={opts.maxLength ?? MAX_TEXT_LENGTH}
        textAlignVertical={opts.multiline !== false ? 'top' : 'auto'}
      />
      <Text
        size="xs"
        color={opts.currentLength < MIN_TEXT_LENGTH ? status.warning.DEFAULT : colors.textMuted}
        style={styles.characterCount}
      >
        {opts.currentLength}/{opts.maxLength ?? MAX_TEXT_LENGTH}
      </Text>
    </View>
  );

  // ─── Category-specific form sections ────────────────────────────────────────

  const renderBugFields = () => (
    <>
      {renderModuleSelector()}

      {/* Severity picker */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
          {t('feedback.bug.severityLabel' as TranslationKey)}
        </Text>
        <View style={styles.pillRow}>
          {SEVERITY_OPTIONS.map(opt => {
            const isActive = severity === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.pill,
                  {
                    backgroundColor: isActive ? `${opt.color}20` : colors.buttonInactive,
                    borderColor: isActive ? opt.color : colors.border,
                  },
                ]}
                onPress={() => {
                  selectionHaptic();
                  setSeverity(opt.value);
                }}
                activeOpacity={0.7}
              >
                <Text
                  size="sm"
                  weight={isActive ? 'semibold' : 'regular'}
                  color={isActive ? opt.color : colors.text}
                >
                  {t(opt.labelKey as TranslationKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {renderTextInput({
        label: t('feedback.bug.stepsLabel' as TranslationKey),
        placeholder: t('feedback.bug.stepsPlaceholder' as TranslationKey),
        inputRef: stepsInputRef,
        onChange: (text: string) => {
          stepsRef.current = text;
          setStepsLength(text.trim().length);
        },
        currentLength: stepsLength,
      })}

      {renderTextInput({
        label: t('feedback.bug.expectedLabel' as TranslationKey),
        placeholder: t('feedback.bug.expectedPlaceholder' as TranslationKey),
        inputRef: expectedInputRef,
        onChange: (text: string) => {
          expectedRef.current = text;
          setExpectedLength(text.trim().length);
        },
        currentLength: expectedLength,
      })}

      {renderScreenshotsSection()}
    </>
  );

  const renderFeatureFields = () => (
    <>
      {renderModuleSelector()}

      {renderTextInput({
        label: t('feedback.feature.titleLabel' as TranslationKey),
        placeholder: t('feedback.feature.titlePlaceholder' as TranslationKey),
        inputRef: featureTitleInputRef,
        onChange: (text: string) => {
          featureTitleRef.current = text;
          setFeatureTitleLength(text.trim().length);
        },
        currentLength: featureTitleLength,
        multiline: false,
        maxLength: 100,
      })}

      {renderTextInput({
        label: t('feedback.feature.descriptionLabel' as TranslationKey),
        placeholder: t('feedback.feature.descriptionPlaceholder' as TranslationKey),
        inputRef: featureDescInputRef,
        onChange: (text: string) => {
          featureDescRef.current = text;
          setFeatureDescLength(text.trim().length);
        },
        currentLength: featureDescLength,
      })}

      {renderTextInput({
        label: t('feedback.feature.useCaseLabel' as TranslationKey),
        placeholder: t('feedback.feature.useCasePlaceholder' as TranslationKey),
        inputRef: useCaseInputRef,
        onChange: (text: string) => {
          useCaseRef.current = text;
          setUseCaseLength(text.trim().length);
        },
        currentLength: useCaseLength,
      })}
    </>
  );

  const renderImprovementFields = () => (
    <>
      {/* Disappointment scale */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
          {t('feedback.pmf.disappointmentLabel' as TranslationKey)}
        </Text>
        <View style={styles.moduleCards}>
          {DISAPPOINTMENT_OPTIONS.map(opt => {
            const isActive = disappointment === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.moduleCard,
                  {
                    backgroundColor: isActive ? `${colors.buttonActive}15` : colors.buttonInactive,
                    borderColor: isActive ? colors.buttonActive : colors.border,
                  },
                ]}
                onPress={() => {
                  selectionHaptic();
                  setDisappointment(opt.value);
                }}
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
                    name={opt.icon}
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
                  {t(opt.labelKey as TranslationKey)}
                </Text>
                {isActive && (
                  <Ionicons name="checkmark-circle" size={18} color={colors.buttonActive} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {renderTextInput({
        label: t('feedback.pmf.mainBenefitLabel' as TranslationKey),
        placeholder: t('feedback.pmf.mainBenefitPlaceholder' as TranslationKey),
        inputRef: mainBenefitInputRef,
        onChange: (text: string) => {
          mainBenefitRef.current = text;
          setMainBenefitLength(text.trim().length);
        },
        currentLength: mainBenefitLength,
      })}

      {renderTextInput({
        label: t('feedback.pmf.idealUserLabel' as TranslationKey),
        placeholder: t('feedback.pmf.idealUserPlaceholder' as TranslationKey),
        inputRef: idealUserInputRef,
        onChange: (text: string) => {
          idealUserRef.current = text;
          setIdealUserLength(text.trim().length);
        },
        currentLength: idealUserLength,
      })}

      {renderTextInput({
        label: t('feedback.pmf.improveLabel' as TranslationKey),
        placeholder: t('feedback.pmf.improvePlaceholder' as TranslationKey),
        inputRef: improveInputRef,
        onChange: (text: string) => {
          improveRef.current = text;
          setImproveLength(text.trim().length);
        },
        currentLength: improveLength,
      })}
    </>
  );

  const renderCategoryFields = () => {
    switch (selectedCategory) {
      case 'bug':
        return renderBugFields();
      case 'feature':
        return renderFeatureFields();
      case 'improvement':
        return renderImprovementFields();
      default:
        return null;
    }
  };

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

          {/* Category-specific fields */}
          {renderCategoryFields()}
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

  // Pill buttons (severity)
  pillRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  pill: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
