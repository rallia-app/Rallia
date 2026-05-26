/**
 * Feedback Report Bottom Sheet
 *
 * A unified bottom sheet for all user feedback: value proposition,
 * bug reports, and feature suggestions.
 * Can be triggered via shake gesture, FAB, or settings menu.
 *
 * Uses react-native-actions-sheet for cross-platform keyboard handling.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Image,
  TextInput,
  Keyboard,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { Text, useToast } from '@rallia/shared-components';
import {
  useTheme,
  usePlacesAutocomplete,
  useToggleFeedbackVote,
  getCachedFeedbackById,
  type PlaceDetails,
} from '@rallia/shared-hooks';
import {
  submitUserFeedback,
  Logger,
  type UserFeedbackModule,
  type UserFeedbackCategory,
  type UserFeedbackMetadata,
  type BugFeedbackMetadata,
  type FeatureFeedbackMetadata,
  type ImprovementFeedbackMetadata,
  type MissingCourtFeedbackMetadata,
  type PublicFeedback,
  type PublicFeedbackCategory,
} from '@rallia/shared-services';
import { lightHaptic, successHaptic, warningHaptic, selectionHaptic } from '@rallia/shared-utils';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  neutral,
  base,
  status,
  secondary,
} from '@rallia/design-system';

import { useAuth, useTranslation, type TranslationKey, useImagePicker } from '#/hooks';
import { useActionsSheet } from '#/context';
import { uploadImage } from '#/services/imageUpload';

import { FeedbackBrowseList } from './feedback/FeedbackBrowseList';
import { FeedbackDetailView } from './feedback/FeedbackDetailView';

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
  {
    value: 'missing_court',
    icon: 'tennisball-outline',
    labelKey: 'feedback.categories.missingCourt',
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

export function FeedbackReportActionSheet({ payload }: SheetProps<'feedback-report'>) {
  const trigger = payload?.trigger ?? null;
  const initialView = payload?.initialView ?? 'browse';
  const initialCategory = payload?.initialCategory ?? null;
  const { theme } = useTheme();
  const { session } = useAuth();
  const { t } = useTranslation();
  const toast = useToast();
  const isDark = theme === 'dark';
  const { pickMultipleFromGallery } = useImagePicker({ skipEditing: true });
  const queryClient = useQueryClient();
  const toggleFeedbackVote = useToggleFeedbackVote();
  const { openSheet: openAuthSheet } = useActionsSheet();

  // View router state
  const [view, setView] = useState<'browse' | 'detail' | 'compose'>(initialView);
  const [browseCategory, setBrowseCategory] = useState<PublicFeedbackCategory>(
    initialCategory === 'feature' ? 'feature' : 'bug'
  );
  // Detail view tracks the row id and a snapshot. The cache is the source of
  // truth — the snapshot is only a fallback for rows that fall out of the
  // active list query (e.g., category swap with detail still open).
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const detailSnapshotRef = useRef<PublicFeedback | null>(null);
  const cachedDetail = detailItemId ? getCachedFeedbackById(queryClient, detailItemId) : undefined;
  const detailItem = cachedDetail ?? detailSnapshotRef.current;

  // Shared state
  const [selectedCategory, setSelectedCategory] = useState<UserFeedbackCategory | null>(
    initialCategory
  );
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

  // Missing court-specific state
  const courtDetailsRef = useRef('');
  const courtDetailsInputRef = useRef<TextInput | null>(null);
  const [courtDetailsLength, setCourtDetailsLength] = useState(0);
  const [placeSearchQuery, setPlaceSearchQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const hasSelectedPlace = selectedPlace !== null;

  const {
    predictions: placePredictions,
    isLoading: placesLoading,
    getPlaceDetails,
    clearPredictions,
  } = usePlacesAutocomplete({
    searchQuery: placeSearchQuery,
    enabled: selectedCategory === 'missing_court' && !hasSelectedPlace,
  });

  // Theme colors
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
        return selectedModule !== null && stepsLength >= MIN_TEXT_LENGTH;
      case 'feature':
        return featureTitleLength >= MIN_TEXT_LENGTH && featureDescLength >= MIN_TEXT_LENGTH;
      case 'improvement':
        return disappointment !== null && improveLength >= MIN_TEXT_LENGTH;
      case 'missing_court':
        return hasSelectedPlace || courtDetailsLength >= MIN_TEXT_LENGTH;
      default:
        return false;
    }
  }, [
    selectedCategory,
    selectedModule,
    severity,
    stepsLength,
    featureTitleLength,
    featureDescLength,
    disappointment,
    improveLength,
    hasSelectedPlace,
    courtDetailsLength,
  ]);

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
    // Missing court
    courtDetailsRef.current = '';
    courtDetailsInputRef.current?.clear();
    setCourtDetailsLength(0);
    setPlaceSearchQuery('');
    setSelectedPlace(null);
    clearPredictions();
  }, [clearPredictions]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    lightHaptic();
    SheetManager.hide('feedback-report');
  }, []);

  const handleSheetClose = useCallback(() => {
    // Reset form when sheet closes
    setTimeout(() => {
      setSelectedCategory(null);
      setSelectedModule(null);
      setScreenshots([]);
      setIsSubmitting(false);
      resetCategoryFields();
      setView('browse');
      setDetailItemId(null);
      detailSnapshotRef.current = null;
    }, 300);
  }, [resetCategoryFields]);

  // Browse → compose CTA: prefill category from active tab.
  const handleStartCompose = useCallback(() => {
    void lightHaptic();
    setSelectedCategory(browseCategory);
    setView('compose');
  }, [browseCategory]);

  const handleSelectBrowseItem = useCallback((item: PublicFeedback) => {
    void lightHaptic();
    detailSnapshotRef.current = item;
    setDetailItemId(item.id);
    setView('detail');
  }, []);

  const handleBackFromDetail = useCallback(() => {
    void lightHaptic();
    setDetailItemId(null);
    detailSnapshotRef.current = null;
    setView('browse');
  }, []);

  const handleBackFromCompose = useCallback(() => {
    void lightHaptic();
    setView('browse');
  }, []);

  // Toggle vote inside the detail view. The mutation updates the shared
  // browse cache, so the list reflects the new state when the user navigates
  // back without an extra refetch.
  const handleDetailToggleVote = () => {
    if (!detailItem) return;
    if (!session?.user?.id) {
      openAuthSheet();
      return;
    }
    toggleFeedbackVote.mutate(
      {
        feedbackId: detailItem.id,
        wasVoted: detailItem.has_voted,
        playerId: session.user.id,
      },
      {
        onError: error => {
          Logger.error('Failed to toggle vote', error);
        },
      }
    );
  };

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

  // Handle add screenshot
  const handleAddScreenshot = useCallback(async () => {
    const remaining = MAX_SCREENSHOTS - screenshots.length;
    if (remaining <= 0) {
      toast.error(t('feedback.maxScreenshotsReached', { max: MAX_SCREENSHOTS }));
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
          ...(severity && { severity }),
          steps_to_reproduce: stepsRef.current.trim(),
          ...(expectedRef.current.trim() && {
            expected_vs_actual: expectedRef.current.trim(),
          }),
        };
      case 'feature':
        return {
          feature_title: featureTitleRef.current.trim(),
          description: featureDescRef.current.trim(),
          ...(useCaseRef.current.trim() && { use_case: useCaseRef.current.trim() }),
        };
      case 'improvement':
        return {
          disappointment_score: disappointment!,
          ...(mainBenefitRef.current.trim() && {
            main_benefit: mainBenefitRef.current.trim(),
          }),
          ...(idealUserRef.current.trim() && { ideal_user: idealUserRef.current.trim() }),
          how_to_improve: improveRef.current.trim(),
        };
      case 'missing_court':
        return {
          ...(selectedPlace && {
            place_name: selectedPlace.name,
            address: selectedPlace.address,
            latitude: selectedPlace.latitude,
            longitude: selectedPlace.longitude,
            place_id: selectedPlace.placeId,
          }),
          ...(courtDetailsRef.current.trim() && {
            details: courtDetailsRef.current.trim(),
          }),
        };
      default:
        return undefined;
    }
  }, [selectedCategory, severity, disappointment, selectedPlace]);

  // Build subject/message from category-specific fields for backward compat
  const buildSubjectAndMessage = useCallback((): { subject: string; message: string } => {
    switch (selectedCategory) {
      case 'bug': {
        const parts = [`Steps: ${stepsRef.current.trim()}`];
        if (expectedRef.current.trim())
          parts.push(`Expected vs Actual: ${expectedRef.current.trim()}`);
        return {
          subject: severity ? `[${severity}] Bug Report` : 'Bug Report',
          message: parts.join('\n\n'),
        };
      }
      case 'feature': {
        const parts = [featureDescRef.current.trim()];
        if (useCaseRef.current.trim()) parts.push(`Use case: ${useCaseRef.current.trim()}`);
        return {
          subject: featureTitleRef.current.trim(),
          message: parts.join('\n\n'),
        };
      }
      case 'improvement': {
        const parts = [];
        if (mainBenefitRef.current.trim()) parts.push(`Benefit: ${mainBenefitRef.current.trim()}`);
        if (idealUserRef.current.trim()) parts.push(`Ideal user: ${idealUserRef.current.trim()}`);
        parts.push(`Improve: ${improveRef.current.trim()}`);
        return {
          subject: `PMF Survey — ${disappointment}`,
          message: parts.join('\n'),
        };
      }
      case 'missing_court': {
        const parts = [];
        if (selectedPlace) parts.push(`Location: ${selectedPlace.name}, ${selectedPlace.address}`);
        if (courtDetailsRef.current.trim()) parts.push(courtDetailsRef.current.trim());
        return {
          subject: `Missing Court: ${selectedPlace?.name || 'Unknown'}`,
          message: parts.join('\n\n'),
        };
      }
      default:
        return { subject: '', message: '' };
    }
  }, [selectedCategory, severity, disappointment, selectedPlace]);

  // Handle submit
  const handleSubmit = async () => {
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
      toast.success(t('bugReport.success'));
      Logger.logUserAction('feedback_report_submitted', {
        trigger,
        category: selectedCategory,
        module: selectedModule,
        screenshotCount: screenshots.length,
      });
      SheetManager.hide('feedback-report');
    } catch (error) {
      Logger.error('Failed to submit feedback report', error as Error);
      toast.error(t('bugReport.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const renderModuleSelector = () => (
    <View style={styles.section}>
      <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
        {t('bugReport.moduleLabel')}
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
        {t('feedback.screenshotsLabel')}
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
            {t('feedback.screenshotsHint', { max: MAX_SCREENSHOTS })}
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
    optional?: boolean;
  }) => (
    <View style={styles.section}>
      <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
        {opts.label}
        {opts.optional && (
          <Text size="xs" color={colors.textMuted}>
            {'  '}({t('feedback.optional')})
          </Text>
        )}
      </Text>
      <TextInput
        ref={opts.inputRef}
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
        color={
          !opts.optional && opts.currentLength < MIN_TEXT_LENGTH
            ? status.warning.DEFAULT
            : colors.textMuted
        }
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
          {t('feedback.bug.severityLabel')}
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
        label: t('feedback.bug.stepsLabel'),
        placeholder: t('feedback.bug.stepsPlaceholder'),
        inputRef: stepsInputRef,
        onChange: (text: string) => {
          stepsRef.current = text;
          setStepsLength(text.trim().length);
        },
        currentLength: stepsLength,
      })}

      {renderTextInput({
        label: t('feedback.bug.expectedLabel'),
        placeholder: t('feedback.bug.expectedPlaceholder'),
        inputRef: expectedInputRef,
        onChange: (text: string) => {
          expectedRef.current = text;
          setExpectedLength(text.trim().length);
        },
        currentLength: expectedLength,
        optional: true,
      })}

      {renderScreenshotsSection()}
    </>
  );

  const renderFeatureFields = () => (
    <>
      {renderModuleSelector()}

      {renderTextInput({
        label: t('feedback.feature.titleLabel'),
        placeholder: t('feedback.feature.titlePlaceholder'),
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
        label: t('feedback.feature.descriptionLabel'),
        placeholder: t('feedback.feature.descriptionPlaceholder'),
        inputRef: featureDescInputRef,
        onChange: (text: string) => {
          featureDescRef.current = text;
          setFeatureDescLength(text.trim().length);
        },
        currentLength: featureDescLength,
      })}

      {renderTextInput({
        label: t('feedback.feature.useCaseLabel'),
        placeholder: t('feedback.feature.useCasePlaceholder'),
        inputRef: useCaseInputRef,
        onChange: (text: string) => {
          useCaseRef.current = text;
          setUseCaseLength(text.trim().length);
        },
        currentLength: useCaseLength,
        optional: true,
      })}
    </>
  );

  const renderImprovementFields = () => (
    <>
      {/* Disappointment scale */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
          {t('feedback.pmf.disappointmentLabel')}
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
        label: t('feedback.pmf.mainBenefitLabel'),
        placeholder: t('feedback.pmf.mainBenefitPlaceholder'),
        inputRef: mainBenefitInputRef,
        onChange: (text: string) => {
          mainBenefitRef.current = text;
          setMainBenefitLength(text.trim().length);
        },
        currentLength: mainBenefitLength,
        optional: true,
      })}

      {renderTextInput({
        label: t('feedback.pmf.improveLabel'),
        placeholder: t('feedback.pmf.improvePlaceholder'),
        inputRef: improveInputRef,
        onChange: (text: string) => {
          improveRef.current = text;
          setImproveLength(text.trim().length);
        },
        currentLength: improveLength,
      })}

      {renderTextInput({
        label: t('feedback.pmf.idealUserLabel'),
        placeholder: t('feedback.pmf.idealUserPlaceholder'),
        inputRef: idealUserInputRef,
        onChange: (text: string) => {
          idealUserRef.current = text;
          setIdealUserLength(text.trim().length);
        },
        currentLength: idealUserLength,
        optional: true,
      })}
    </>
  );

  const handleSelectPlace = useCallback(
    async (placeId: string) => {
      const details = await getPlaceDetails(placeId);
      if (details) {
        setSelectedPlace(details);
        setPlaceSearchQuery('');
        clearPredictions();
        void lightHaptic();
      }
    },
    [getPlaceDetails, clearPredictions]
  );

  const handleClearPlace = useCallback(() => {
    setSelectedPlace(null);
    setPlaceSearchQuery('');
    clearPredictions();
    void lightHaptic();
  }, [clearPredictions]);

  const renderMissingCourtFields = () => (
    <>
      {/* Google Places search */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
          {t('feedback.missingCourt.searchLabel')}
        </Text>

        {hasSelectedPlace ? (
          <View
            style={[
              styles.selectedPlaceCard,
              {
                backgroundColor: `${colors.buttonActive}15`,
                borderColor: colors.buttonActive,
              },
            ]}
          >
            <View style={styles.selectedPlaceContent}>
              <Ionicons name="location" size={20} color={colors.buttonActive} />
              <View style={styles.selectedPlaceText}>
                <Text size="sm" weight="semibold" color={colors.text}>
                  {selectedPlace.name}
                </Text>
                <Text size="xs" color={colors.textMuted} numberOfLines={2}>
                  {selectedPlace.address}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClearPlace} activeOpacity={0.7}>
              <Text size="sm" weight="semibold" color={colors.buttonActive}>
                {t('feedback.missingCourt.clearPlace')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder={t('feedback.missingCourt.searchPlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={placeSearchQuery}
              onChangeText={setPlaceSearchQuery}
            />

            {placesLoading && (
              <ActivityIndicator
                size="small"
                color={colors.buttonActive}
                style={styles.placesLoading}
              />
            )}

            {placePredictions.length > 0 && (
              <View style={[styles.predictionsContainer, { borderColor: colors.border }]}>
                {placePredictions.map(prediction => (
                  <TouchableOpacity
                    key={prediction.placeId}
                    style={[styles.predictionItem, { borderBottomColor: colors.border }]}
                    onPress={() => void handleSelectPlace(prediction.placeId)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="location-outline" size={18} color={colors.textMuted} />
                    <View style={styles.predictionText}>
                      <Text size="sm" weight="semibold" color={colors.text} numberOfLines={1}>
                        {prediction.name}
                      </Text>
                      <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                        {prediction.address}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </View>

      {renderTextInput({
        label: t('feedback.missingCourt.detailsLabel'),
        placeholder: t('feedback.missingCourt.detailsPlaceholder'),
        inputRef: courtDetailsInputRef,
        onChange: (text: string) => {
          courtDetailsRef.current = text;
          setCourtDetailsLength(text.trim().length);
        },
        currentLength: courtDetailsLength,
        optional: hasSelectedPlace,
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
      case 'missing_court':
        return renderMissingCourtFields();
      default:
        return null;
    }
  };

  // ── View-router branches ────────────────────────────────────────────────────

  if (view === 'browse') {
    return (
      <ActionSheet
        gestureEnabled
        onClose={handleSheetClose}
        containerStyle={[
          styles.sheetBackground,
          styles.sheetContainer,
          { backgroundColor: colors.cardBackground },
        ]}
        indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.badge, { backgroundColor: secondary[500] }]}>
            <Ionicons name="chatbox-ellipses-outline" size={14} color={base.white} />
            <Text size="sm" weight="semibold" color={base.white}>
              {t('feedback.sheetTitle')}
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

        <FeedbackBrowseList
          category={browseCategory}
          onCategoryChange={setBrowseCategory}
          onSelectItem={handleSelectBrowseItem}
          onCreate={handleStartCompose}
          playerId={session?.user?.id ?? null}
        />
      </ActionSheet>
    );
  }

  if (view === 'detail' && detailItem) {
    return (
      <ActionSheet
        gestureEnabled
        onClose={handleSheetClose}
        containerStyle={[
          styles.sheetBackground,
          styles.sheetContainer,
          { backgroundColor: colors.cardBackground },
        ]}
        indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      >
        <FeedbackDetailView
          item={detailItem}
          onBack={handleBackFromDetail}
          onToggleVote={handleDetailToggleVote}
        />
      </ActionSheet>
    );
  }

  return (
    <ActionSheet
      gestureEnabled
      onClose={handleSheetClose}
      containerStyle={[
        styles.sheetBackground,
        styles.sheetContainer,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {/* Back button — only when we came from browse (i.e., bug/feature) */}
        {(initialView === 'browse' || browseCategory) && (
          <TouchableOpacity
            onPress={handleBackFromCompose}
            style={styles.backInline}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        <View style={[styles.badge, { backgroundColor: secondary[500] }]}>
          <Ionicons name="chatbox-ellipses-outline" size={14} color={base.white} />
          <Text size="sm" weight="semibold" color={base.white}>
            {t('feedback.sheetTitle')}
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

      <View style={styles.formContainer}>
        {/* Scrollable content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Subtitle */}
          <Text size="sm" color={colors.textSecondary} style={styles.subtitle}>
            {t('feedback.description')}
          </Text>

          {/* Category Selection */}
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              {t('feedback.categoryLabel')}
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
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
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
                  {t('feedback.submitButton')}
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
      </View>
    </ActionSheet>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  sheetContainer: {
    flex: 1,
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },

  // Header
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
  backInline: {
    position: 'absolute',
    left: 16,
    padding: spacingPixels[1],
  },

  // Content
  formContainer: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    flex: 0,
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

  // Module cards
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

  // Missing court — Google Places
  selectedPlaceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  selectedPlaceContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacingPixels[3],
  },
  selectedPlaceText: {
    flex: 1,
    gap: 2,
  },
  placesLoading: {
    marginTop: spacingPixels[3],
  },
  predictionsContainer: {
    marginTop: spacingPixels[2],
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  predictionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    gap: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  predictionText: {
    flex: 1,
    gap: 2,
  },

  // Footer
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

export default FeedbackReportActionSheet;
