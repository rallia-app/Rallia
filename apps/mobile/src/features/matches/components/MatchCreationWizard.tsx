/**
 * Match Creation Wizard
 *
 * A 3-step wizard for creating matches with horizontal slide animations,
 * progress indicator, and full i18n/theme support. Navigation between steps
 * is done via buttons only (swipe disabled for better Android scroll behavior).
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Localization from 'expo-localization';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  secondary,
  base,
} from '@rallia/design-system';

const BASE_WHITE = '#ffffff';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useCreateMatch, useUpdateMatch } from '@rallia/shared-hooks';
import { validateMatchUpdate, getMatchWithDetails } from '@rallia/shared-services';

import { useTheme } from '@rallia/shared-hooks';
import { useTranslation, type TranslationKey } from '../../../hooks/useTranslation';
import { useSport, type MatchDetailData } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';
import { useAuth } from '../../../hooks';
import { useMatchForm, useMatchDraft, calculateEndTime, matchToFormData } from '../hooks';
import { supabase } from '../../../lib/supabase';
import { shareMatch } from '../../../utils';
import type { MatchFormSchemaData } from '@rallia/shared-types';

import { WhenFormatStep } from './steps/WhenFormatStep';
import { WhereStep } from './steps/WhereStep';
import { PreferencesStep } from './steps/PreferencesStep';
import { PlayerInviteStep } from './PlayerInviteStep';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_STEPS = 3;

// =============================================================================
// TYPES
// =============================================================================

/** Initial booking data when opening wizard from facility "Create game" */
export interface InitialBookingForWizard {
  facility: unknown;
  slot: unknown;
  facilityId: string;
  courtId: string;
  courtNumber: number | null;
}

interface MatchCreationWizardProps {
  /** Callback when wizard should be closed (closes entire sheet) */
  onClose: () => void;
  /** Callback to go back to the action sheet landing slide */
  onBackToLanding: () => void;
  /** Callback when match is created/updated successfully */
  onSuccess?: (matchId: string) => void;
  /** If provided, wizard is in edit mode with pre-filled data */
  editMatch?: MatchDetailData;
  /** When set, wizard pre-fills steps 1–2 from this booking and starts at step 3 */
  initialBookingForWizard?: InitialBookingForWizard | null;
  /** Called after applying initialBookingForWizard so context can clear it */
  onConsumeInitialBooking?: () => void;
}

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  progressActive: string;
  progressInactive: string;
}

// =============================================================================
// PROGRESS BAR COMPONENT
// =============================================================================

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ currentStep, totalSteps, colors, t }) => {
  const progress = useSharedValue((currentStep / totalSteps) * 100);

  // Animate progress when step changes
  useEffect(() => {
    progress.value = withTiming((currentStep / totalSteps) * 100, {
      duration: 300,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, totalSteps]);

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  // Get step name for current step (order: Where -> When -> Preferences)
  const stepNames = [
    t('matchCreation.stepNames.where'),
    t('matchCreation.stepNames.when'),
    t('matchCreation.stepNames.preferences'),
  ];
  const currentStepName = stepNames[currentStep - 1] || '';

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {t('matchCreation.step')
            .replace('{current}', String(currentStep))
            .replace('{total}', String(totalSteps))}
        </Text>
        <Text size="sm" weight="bold" color={colors.progressActive}>
          {currentStepName}
        </Text>
      </View>
      <View style={[styles.progressBarBg, { backgroundColor: colors.progressInactive }]}>
        <Animated.View
          style={[
            styles.progressBarFill,
            { backgroundColor: colors.progressActive },
            animatedProgressStyle,
          ]}
        />
      </View>
    </View>
  );
};

// =============================================================================
// WIZARD HEADER COMPONENT
// =============================================================================

interface WizardHeaderProps {
  currentStep: number;
  onBack: () => void;
  onBackToLanding: () => void;
  onClose: () => void;
  sportName: string;
  sportKey?: string;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}

const WizardHeader: React.FC<WizardHeaderProps> = ({
  currentStep,
  onBack,
  onBackToLanding,
  onClose,
  sportName,
  sportKey,
  colors,
  t,
}) => {
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      {/* Back button (visible on all steps) */}
      <View style={styles.headerLeft}>
        {currentStep === 1 ? (
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              lightHaptic();
              onBackToLanding();
            }}
            style={styles.headerButton}
            accessibilityLabel="Back to actions"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              lightHaptic();
              onBack();
            }}
            style={styles.headerButton}
            accessibilityLabel={t('matchCreation.accessibility.previousStep')}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
          </TouchableOpacity>
        )}
      </View>

      {/* Sport badge */}
      <View style={[styles.sportBadge, { backgroundColor: colors.buttonActive }]}>
        <SportIcon sportName={sportKey ?? 'tennis'} size={14} color={BASE_WHITE} />
        <Text size="sm" weight="semibold" color={BASE_WHITE}>
          {sportName}
        </Text>
      </View>

      {/* Close button */}
      <View style={styles.headerRight}>
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            lightHaptic();
            onClose();
          }}
          style={styles.headerButton}
          accessibilityLabel={t('matchCreation.accessibility.closeWizard')}
          accessibilityRole="button"
        >
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// MAIN WIZARD COMPONENT
// =============================================================================

// Helpers for initial booking slot data (mirror WhereStep logic)
function formatTime24(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
function calculateDurationMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
}
function mapDurationToFormValue(minutes: number): '30' | '60' | '90' | '120' | 'custom' {
  const standardDurations = [30, 60, 90, 120] as const;
  for (const d of standardDurations) {
    if (minutes === d) return String(d) as '30' | '60' | '90' | '120';
  }
  return 'custom';
}

export const MatchCreationWizard: React.FC<MatchCreationWizardProps> = ({
  onClose,
  onBackToLanding,
  onSuccess,
  editMatch,
  initialBookingForWizard,
  onConsumeInitialBooking,
}) => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const { selectedSport } = useSport();
  const isDark = theme === 'dark';
  const toast = useToast();

  // Determine if we're in edit mode
  const isEditMode = !!editMatch;

  // State
  const [currentStep, setCurrentStep] = useState(1);
  // Track highest step visited for lazy mounting (avoids mounting all steps on initial render)
  const [highestStepVisited, setHighestStepVisited] = useState(1);

  // Track last saved state to detect unsaved changes
  const lastSavedStep = useRef<number | null>(null);
  const hasUnsavedChanges = useRef(false);

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors: ThemeColors = {
    background: themeColors.background,
    cardBackground: themeColors.card,
    text: themeColors.foreground,
    textSecondary: isDark ? primary[300] : neutral[600],
    textMuted: themeColors.mutedForeground,
    border: themeColors.border,
    buttonActive: isDark ? primary[500] : primary[600],
    buttonInactive: themeColors.muted,
    buttonTextActive: BASE_WHITE,
    progressActive: isDark ? primary[500] : primary[600],
    progressInactive: themeColors.muted,
  };

  // Form state
  const sportId = editMatch?.sport_id ?? selectedSport?.id ?? '';
  // Get device timezone from calendar settings (memoized to avoid re-renders)
  const timezone = useMemo(() => {
    const calendars = Localization.getCalendars();
    return calendars[0]?.timeZone || 'UTC';
  }, []);

  // State for player preferences
  const [playerPreferences, setPlayerPreferences] = useState<Partial<MatchFormSchemaData> | null>(
    null
  );
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  // Preferred facility ID from player's profile (persists separately from form's facilityId)
  const [preferredFacilityId, setPreferredFacilityId] = useState<string | undefined>(undefined);

  // State for booked slot data (when user books a court slot in Step 1)
  // This locks the date/time/duration/timezone fields in Step 2
  const [bookedSlotData, setBookedSlotData] = useState<{
    matchDate: string;
    startTime: string;
    endTime: string;
    duration: '30' | '60' | '90' | '120' | 'custom';
    customDurationMinutes?: number;
    timezone: string;
  } | null>(null);

  // Reset preferences when sportId changes (handles sport switching)
  useEffect(() => {
    setPlayerPreferences(null);
    setPreferencesLoading(true);
    setPreferredFacilityId(undefined);
  }, [sportId]);

  // Fetch player preferences for the selected sport
  useEffect(() => {
    if (isEditMode || !session?.user?.id || !sportId) {
      setPreferencesLoading(false);
      return;
    }

    const fetchPlayerPreferences = async () => {
      try {
        const { data, error } = await supabase
          .from('player_sport')
          .select('preferred_match_duration, preferred_match_type, preferred_facility_id')
          .eq('player_id', session.user.id)
          .eq('sport_id', sportId)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          console.error('Failed to fetch player preferences:', error);
          setPreferencesLoading(false);
          return;
        }

        if (data) {
          // Map preferences to form values
          const mappedPreferences: Partial<MatchFormSchemaData> = {};

          // Duration values now match directly (no mapping needed)
          if (data.preferred_match_duration) {
            mappedPreferences.duration = data.preferred_match_duration as
              | '30'
              | '60'
              | '90'
              | '120'
              | 'custom';
          }

          // Map match type: form values now match database values directly
          if (data.preferred_match_type) {
            const typeMap: Record<string, 'casual' | 'competitive' | 'both'> = {
              casual: 'casual',
              competitive: 'competitive',
              both: 'both',
            };
            mappedPreferences.playerExpectation = typeMap[data.preferred_match_type] || 'both';
          }

          // Map preferred facility: if preferred_facility_id exists, set locationType to 'facility'
          // Note: We don't set facilityId here anymore - the preferred facility is shown first in the list
          // but not auto-selected. The user can select it if they want.
          if (data.preferred_facility_id) {
            mappedPreferences.locationType = 'facility';
            setPreferredFacilityId(data.preferred_facility_id);
          }

          setPlayerPreferences(mappedPreferences);
        }
      } catch (error) {
        console.error('Error fetching player preferences:', error);
      } finally {
        setPreferencesLoading(false);
      }
    };

    fetchPlayerPreferences();
  }, [session?.user?.id, sportId, isEditMode]);

  // Calculate initial values from editMatch if in edit mode, or merge with player preferences
  const initialValues = useMemo(() => {
    if (editMatch) {
      return matchToFormData(editMatch, timezone);
    }
    // Merge player preferences with defaults (will be handled in useMatchForm)
    return playerPreferences || undefined;
  }, [editMatch, timezone, playerPreferences]);

  const { form, values, isDirty, validateStep, resetForm, loadFromDraft } = useMatchForm({
    sportId,
    timezone,
    initialValues,
  });

  // Draft persistence
  const {
    hasDraft,
    draft,
    saveDraft,
    clearDraft,
    isDraftForSport,
    isLoading: isDraftLoading,
  } = useMatchDraft();

  // Apply player preferences to form when they're loaded (only if not in edit mode and no draft for this sport)
  useEffect(() => {
    // Skip if there's a draft for the current sport (user might want to resume it)
    const hasDraftForCurrentSport = hasDraft && isDraftForSport(sportId);

    if (
      isEditMode ||
      preferencesLoading ||
      !playerPreferences ||
      hasDraftForCurrentSport ||
      Object.keys(playerPreferences).length === 0
    ) {
      return;
    }

    // Apply preferences to form
    Object.entries(playerPreferences).forEach(([key, value]) => {
      if (value !== undefined) {
        form.setValue(key as keyof MatchFormSchemaData, value as never, { shouldDirty: false });
      }
    });
  }, [playerPreferences, preferencesLoading, isEditMode, hasDraft, isDraftForSport, sportId, form]);

  // Helper to format date as YYYY-MM-DD in local time
  const formatDateLocal = useCallback((date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  // Apply initial booking data when opening from facility "Create game"
  const hasAppliedInitialBooking = useRef(false);
  useEffect(() => {
    if (!initialBookingForWizard) {
      hasAppliedInitialBooking.current = false;
      return;
    }
    if (!onConsumeInitialBooking || isEditMode || hasAppliedInitialBooking.current) {
      return;
    }
    const { facility, slot, facilityId, courtId, courtNumber } = initialBookingForWizard;
    const slotTyped = slot as { datetime: Date; endDateTime: Date };
    const facilityTyped = facility as {
      name: string;
      address?: string;
      city?: string;
      timezone?: string;
    };
    const facilityTimezone = facilityTyped.timezone || timezone;
    const matchDate = formatDateLocal(slotTyped.datetime);
    const startTime = formatTime24(slotTyped.datetime);
    const endTime = formatTime24(slotTyped.endDateTime);
    const durationMins = calculateDurationMinutes(slotTyped.datetime, slotTyped.endDateTime);
    const duration = mapDurationToFormValue(durationMins);

    form.setValue('locationType', 'facility', { shouldDirty: true });
    form.setValue('facilityId', facilityId, { shouldDirty: true });
    form.setValue('courtId', courtId, { shouldDirty: true });
    form.setValue('courtStatus', 'booked', { shouldDirty: true });
    form.setValue('locationName', facilityTyped.name, { shouldDirty: true });
    const fullAddress = [facilityTyped.address, facilityTyped.city].filter(Boolean).join(', ');
    form.setValue('locationAddress', fullAddress || undefined, { shouldDirty: true });
    form.setValue('matchDate', matchDate, { shouldDirty: true });
    form.setValue('startTime', startTime, { shouldDirty: true });
    form.setValue('endTime', endTime, { shouldDirty: true });
    form.setValue('duration', duration, { shouldDirty: true });
    form.setValue('customDurationMinutes', durationMins, { shouldDirty: true });
    form.setValue('timezone', facilityTimezone, { shouldDirty: true });

    setBookedSlotData({
      matchDate,
      startTime,
      endTime,
      duration,
      customDurationMinutes: durationMins,
      timezone: facilityTimezone,
    });
    setCurrentStep(3);
    hasAppliedInitialBooking.current = true;
    onConsumeInitialBooking();
  }, [
    initialBookingForWizard,
    onConsumeInitialBooking,
    isEditMode,
    form,
    timezone,
    formatDateLocal,
  ]);

  // Delayed success state for smoother UX
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMatchId, setSuccessMatchId] = useState<string | null>(null);
  // Player invitation step (shown after success for new matches)
  const [showInviteStep, setShowInviteStep] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // Match creation mutation
  const { createMatch, isCreating } = useCreateMatch({
    onSuccess: match => {
      // Add a small delay so the creation doesn't feel too instant
      // This gives the user time to see the loading state
      setTimeout(() => {
        successHaptic();
        clearDraft();
        setSuccessMatchId(match.id);
        setShowSuccess(true);
      }, 800); // 800ms delay for perceived effort
    },
    onError: err => {
      warningHaptic();
      toast.error(err.message);
    },
  });

  // Match update mutation (for edit mode)
  const { updateMatch, isUpdating } = useUpdateMatch({
    onSuccess: match => {
      setTimeout(() => {
        successHaptic();
        setSuccessMatchId(match.id);
        setShowSuccess(true);
      }, 800);
    },
    onError: err => {
      warningHaptic();
      toast.error(err.message);
    },
  });

  // Combined loading state
  const isSubmitting = isCreating || isUpdating;

  // Animation values
  const translateX = useSharedValue(0);

  // Track if initial draft check has been done
  const hasCheckedDraft = useRef(false);

  // Check for draft on mount (only once, after loading completes)
  // Skip draft handling when in edit mode
  useEffect(() => {
    // Skip draft handling in edit mode
    if (isEditMode) {
      hasCheckedDraft.current = true;
      return;
    }

    // Only check once on initial mount
    if (hasCheckedDraft.current) return;

    // Wait for draft loading to complete before checking
    if (isDraftLoading) return;

    // Now we know the loading is complete
    if (hasDraft && draft && isDraftForSport(sportId)) {
      hasCheckedDraft.current = true;
      Alert.alert(t('matchCreation.resumeDraft'), t('matchCreation.resumeDraftMessage'), [
        {
          text: t('matchCreation.discardDraft'),
          style: 'destructive',
          onPress: () => {
            clearDraft();
            resetForm();
            lastSavedStep.current = null;
            hasUnsavedChanges.current = false;
          },
        },
        {
          text: t('matchCreation.resumeDraft'),
          onPress: () => {
            loadFromDraft(draft.data);
            setCurrentStep(draft.currentStep);
            setHighestStepVisited(draft.currentStep);
            // Mark draft as already saved at this step
            lastSavedStep.current = draft.currentStep;
            hasUnsavedChanges.current = false;
          },
        },
      ]);
    } else {
      // No draft exists (loading complete, no draft found), mark as checked
      hasCheckedDraft.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraftLoading, hasDraft, draft, sportId, isEditMode]);

  // Track form changes to detect unsaved modifications
  useEffect(() => {
    if (isDirty) {
      hasUnsavedChanges.current = true;
    }
  }, [isDirty, values]);

  // Clear booked slot data when location type changes away from facility or facility is cleared
  // This unlocks the WhenFormatStep when user changes location type after booking a slot
  // Also resets date/time/duration to default values
  useEffect(() => {
    // Clear booking if location type is not 'facility' or facilityId is cleared
    if (values.locationType !== 'facility' || !values.facilityId) {
      setBookedSlotData(prev => {
        if (prev) {
          // Reset date/time/duration to default values
          // Calculate start time (next rounded hour)
          const now = new Date();
          const currentHour = now.getHours();
          const startTime = new Date(now);
          startTime.setHours(currentHour + 1);
          startTime.setMinutes(0);
          startTime.setSeconds(0);

          // Use the start time's date (handles midnight rollover correctly)
          const matchDateStr = formatDateLocal(startTime);
          const startTimeStr = startTime.toTimeString().slice(0, 5);

          // Calculate end time (1 hour after start)
          const endTime = new Date(startTime);
          endTime.setHours(endTime.getHours() + 1);
          const endTimeStr = endTime.toTimeString().slice(0, 5);

          // Reset form values to defaults
          form.setValue('matchDate', matchDateStr, { shouldDirty: true });
          form.setValue('startTime', startTimeStr, { shouldDirty: true });
          form.setValue('endTime', endTimeStr, { shouldDirty: true });
          form.setValue('duration', '60', { shouldDirty: true });
          form.setValue('customDurationMinutes', undefined, { shouldDirty: true });
          form.setValue('timezone', timezone, { shouldDirty: true });

          return null;
        }
        return prev;
      });
    }
  }, [values.locationType, values.facilityId, form, formatDateLocal, timezone]);

  // Animate step changes
  // Animate step changes
  useEffect(() => {
    translateX.value = withSpring(-((currentStep - 1) * SCREEN_WIDTH), {
      damping: 80,
      stiffness: 600,
      overshootClamping: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // Navigate to next step
  const goToNextStep = useCallback(async () => {
    Keyboard.dismiss();

    // Special handling for step 1 (Where): show toast if facility or custom location is not selected
    if (currentStep === 1) {
      if (values.locationType === 'facility' && !values.facilityId) {
        warningHaptic();
        toast.warning(t('matchCreation.validation.facilityRequired'));
        return;
      }
      if (values.locationType === 'custom' && !values.locationName) {
        warningHaptic();
        toast.warning(t('matchCreation.validation.locationNameRequired'));
        return;
      }
    }

    const isValid = await validateStep(currentStep as 1 | 2 | 3);

    if (!isValid) {
      warningHaptic();
      return;
    }

    lightHaptic();

    // Only save draft when not in edit mode
    if (!isEditMode) {
      saveDraft(values, currentStep + 1, sportId);
      // Mark as saved
      lastSavedStep.current = currentStep + 1;
      hasUnsavedChanges.current = false;
    }

    if (currentStep < TOTAL_STEPS) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      setHighestStepVisited(prev => Math.max(prev, nextStep));
    }
  }, [currentStep, validateStep, values, sportId, saveDraft, isEditMode, t, toast]);

  // Navigate to previous step
  const goToPrevStep = useCallback(() => {
    Keyboard.dismiss();
    lightHaptic();
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  // Handle slot booking from WhereStep - auto-fills date/time/duration in WhenStep and jumps to step 3
  const handleSlotBooked = useCallback(
    (slotData: {
      matchDate: string;
      startTime: string;
      endTime: string;
      duration: '30' | '60' | '90' | '120' | 'custom';
      customDurationMinutes?: number;
      timezone: string;
    }) => {
      // Store the booked slot data (this will lock the fields in WhenStep)
      setBookedSlotData(slotData);

      // Update form with the booked slot data
      form.setValue('matchDate', slotData.matchDate, { shouldDirty: true });
      form.setValue('startTime', slotData.startTime, { shouldDirty: true });
      form.setValue('endTime', slotData.endTime, { shouldDirty: true });
      form.setValue('duration', slotData.duration, { shouldDirty: true });
      if (slotData.customDurationMinutes) {
        form.setValue('customDurationMinutes', slotData.customDurationMinutes, {
          shouldDirty: true,
        });
      }
      form.setValue('timezone', slotData.timezone, { shouldDirty: true });

      // Land on Preferences step (step 3) so user only fills out game preferences
      setCurrentStep(3);
      successHaptic();
    },
    [form]
  );

  // Helper to detect impactful changes between original and new values
  const getImpactfulChanges = useCallback((): string[] => {
    if (!editMatch) return [];

    const changes: string[] = [];

    // Date/Time changes
    if (values.matchDate !== editMatch.match_date) changes.push('date');
    if (values.startTime !== editMatch.start_time) changes.push('time');
    if (values.duration !== editMatch.duration) changes.push('duration');

    // Location changes
    if (values.locationType !== editMatch.location_type) changes.push('location');
    if (values.facilityId !== editMatch.facility_id) changes.push('location');
    if (values.locationName !== editMatch.location_name) changes.push('location');

    // Format changes
    if (values.format !== editMatch.format) changes.push('format');

    // Cost changes
    if (values.isCourtFree !== editMatch.is_court_free) changes.push('cost');
    if (values.estimatedCost !== editMatch.estimated_cost) changes.push('cost');
    if (
      values.costSplitType !==
      (editMatch.cost_split_type === 'host_pays'
        ? 'creator_pays'
        : editMatch.cost_split_type === 'split_equal'
          ? 'equal'
          : editMatch.cost_split_type)
    ) {
      changes.push('cost');
    }

    // Remove duplicates
    return [...new Set(changes)];
  }, [editMatch, values]);

  // Perform the actual update
  const performUpdate = useCallback(
    (matchData: Parameters<typeof updateMatch>[0]['updates']) => {
      if (editMatch) {
        updateMatch({
          matchId: editMatch.id,
          updates: matchData,
          // Skip server-side validation since we already validated on the client
          skipValidation: true,
        });
      }
    },
    [editMatch, updateMatch]
  );

  // Share match from success step (fetch then open native share sheet)
  const handleShareSuccess = useCallback(async () => {
    if (!successMatchId) return;
    lightHaptic();
    setIsSharing(true);
    try {
      const match = await getMatchWithDetails(successMatchId);
      if (match) {
        await shareMatch(match as MatchDetailData, { t, locale });
      }
    } catch {
      // Silently handle errors (same as MatchDetailSheet)
    } finally {
      setIsSharing(false);
    }
  }, [successMatchId, t, locale]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    Keyboard.dismiss();
    const isValid = await validateStep(3);

    if (!isValid) {
      warningHaptic();
      return;
    }

    if (!session?.user?.id) {
      toast.error(t('errors.mustBeLoggedIn'));
      return;
    }

    // Calculate end time
    const endTime = calculateEndTime(
      values.startTime,
      values.duration,
      values.customDurationMinutes
    );

    const matchData = {
      sportId: values.sportId,
      createdBy: session.user.id,
      matchDate: values.matchDate,
      startTime: values.startTime,
      endTime,
      timezone: values.timezone,
      format: values.format,
      playerExpectation: values.playerExpectation,
      duration: values.duration,
      // Only include customDurationMinutes when duration is 'custom'
      customDurationMinutes:
        values.duration === 'custom' ? values.customDurationMinutes : undefined,
      locationType: values.locationType,
      facilityId: values.facilityId,
      courtId: values.courtId,
      locationName: values.locationName,
      locationAddress: values.locationAddress,
      customLatitude: values.customLatitude,
      customLongitude: values.customLongitude,
      courtStatus: values.courtStatus,
      isCourtFree: values.isCourtFree,
      costSplitType: values.costSplitType,
      estimatedCost: values.estimatedCost,
      minRatingScoreId: values.minRatingScoreId,
      preferredOpponentGender: values.preferredOpponentGender,
      visibility: values.visibility,
      visibleInGroups: values.visibility === 'private' ? (values.visibleInGroups ?? true) : true,
      visibleInCommunities:
        values.visibility === 'private' ? (values.visibleInCommunities ?? true) : true,
      joinMode: values.joinMode,
      notes: values.notes,
    };

    if (isEditMode && editMatch) {
      // Check if there are joined participants (excluding the creator since they have their own match_participant record)
      const joinedParticipants =
        editMatch.participants?.filter(
          p => p.status === 'joined' && p.player_id !== editMatch.created_by
        ) ?? [];
      const hasParticipants = joinedParticipants.length > 0;

      if (hasParticipants) {
        // Validate the update server-side
        try {
          const validation = await validateMatchUpdate(editMatch.id, matchData);

          if (!validation.canUpdate) {
            // Show error and block update
            warningHaptic();

            // Translate error code to localized message
            const errorMessage = validation.errorCode
              ? t(`matchCreation.validation.errors.${validation.errorCode}`)
              : t('matchCreation.validation.cannotUpdate');

            toast.error(errorMessage);
            return;
          }

          // Check for warnings (e.g., gender mismatch)
          if (validation.warnings && validation.warnings.length > 0) {
            const genderWarning = validation.warnings.find(w => w.type === 'gender_mismatch');

            if (genderWarning) {
              // Show confirmation for gender mismatch
              Alert.alert(
                t('matchCreation.validation.genderMismatchTitle'),
                t('matchCreation.validation.genderMismatchMessage').replace(
                  '{count}',
                  String(genderWarning.affectedParticipantIds.length)
                ),
                [
                  {
                    text: t('common.cancel'),
                    style: 'cancel',
                  },
                  {
                    text: t('matchCreation.validation.updateAnyway'),
                    style: 'destructive',
                    onPress: () => performUpdate(matchData),
                  },
                ]
              );
              return;
            }
          }
        } catch (error) {
          console.error('Validation error:', error);
          // Continue with update if validation fails unexpectedly
        }

        // Check for impactful changes that need confirmation
        const impactfulChanges = getImpactfulChanges();

        if (impactfulChanges.length > 0) {
          // Build a message describing the changes
          const changeDescriptions: string[] = [];
          if (impactfulChanges.includes('date') || impactfulChanges.includes('time')) {
            changeDescriptions.push(t('matchCreation.validation.changes.dateTime'));
          }
          if (impactfulChanges.includes('location')) {
            changeDescriptions.push(t('matchCreation.validation.changes.location'));
          }
          if (impactfulChanges.includes('format')) {
            changeDescriptions.push(t('matchCreation.validation.changes.format'));
          }
          if (impactfulChanges.includes('cost')) {
            changeDescriptions.push(t('matchCreation.validation.changes.cost'));
          }

          const changesList = changeDescriptions.join(', ');

          // Show confirmation dialog
          Alert.alert(
            t('matchCreation.validation.confirmChangesTitle'),
            t('matchCreation.validation.confirmChangesMessage')
              .replace('{changes}', changesList)
              .replace('{count}', String(joinedParticipants.length)),
            [
              {
                text: t('common.cancel'),
                style: 'cancel',
              },
              {
                text: t('matchCreation.validation.confirmUpdate'),
                onPress: () => performUpdate(matchData),
              },
            ]
          );
          return;
        }
      }

      // No participants or no impactful changes - proceed with update
      performUpdate(matchData);
    } else {
      // Create new match
      createMatch(matchData);
    }
  }, [
    validateStep,
    values,
    session,
    createMatch,
    isEditMode,
    editMatch,
    performUpdate,
    getImpactfulChanges,
    t,
    toast,
  ]);

  // Handle close with confirmation
  const handleClose = useCallback(() => {
    Keyboard.dismiss();

    // In edit mode, just ask if they want to discard changes (no draft saving)
    if (isEditMode) {
      if (isDirty) {
        Alert.alert(t('matchCreation.discardChanges'), t('matchCreation.discardEditMessage'), [
          { text: t('matchCreation.keepEditing'), style: 'cancel' },
          {
            text: t('matchCreation.discardChanges'),
            style: 'destructive',
            onPress: onClose,
          },
        ]);
      } else {
        onClose();
      }
      return;
    }

    // Check if there are unsaved changes:
    // 1. Form is dirty (has changes from initial/loaded values)
    // 2. OR we have unsaved changes since last save
    // 3. OR we're on a step beyond 1 and haven't saved yet (user has progressed)
    const hasFormData = isDirty || hasUnsavedChanges.current;
    const hasProgressedWithoutSave = currentStep > 1 && lastSavedStep.current === null;
    const hasChangedSinceLastSave =
      lastSavedStep.current !== null &&
      (currentStep !== lastSavedStep.current || hasUnsavedChanges.current);

    const shouldAskToSave = hasFormData || hasProgressedWithoutSave || hasChangedSinceLastSave;

    if (shouldAskToSave) {
      Alert.alert(t('matchCreation.discardChanges'), t('matchCreation.discardChangesMessage'), [
        { text: t('matchCreation.keepEditing'), style: 'cancel' },
        {
          text: t('matchCreation.saveDraft'),
          onPress: () => {
            saveDraft(values, currentStep, sportId);
            lastSavedStep.current = currentStep;
            hasUnsavedChanges.current = false;
            onClose();
          },
        },
        {
          text: t('matchCreation.discardDraft'),
          style: 'destructive',
          onPress: () => {
            clearDraft();
            onClose();
          },
        },
      ]);
    } else {
      onClose();
    }
  }, [isDirty, values, currentStep, sportId, saveDraft, clearDraft, onClose, t, isEditMode]);

  // Animated styles for step container (button navigation only, no swipe)
  const animatedStepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Success animation values
  const successOpacity = useSharedValue(0);
  const successScale = useSharedValue(0.8);
  const formOpacity = useSharedValue(1);
  // Post-success step transition (success → invite)
  const postSuccessTranslateX = useSharedValue(0);

  // Trigger success animation when showSuccess becomes true
  useEffect(() => {
    if (showSuccess) {
      // Fade out form
      formOpacity.value = withTiming(0, { duration: 150 });
      // Fade in and scale up success view - snappy with no bounce
      successOpacity.value = withTiming(1, { duration: 250 });
      successScale.value = withTiming(1, { duration: 250 });
      // Reset post-success position
      postSuccessTranslateX.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSuccess]);

  // Animate transition to invite step
  useEffect(() => {
    if (showInviteStep) {
      postSuccessTranslateX.value = withTiming(-SCREEN_WIDTH, { duration: 300 });
    } else if (showSuccess) {
      postSuccessTranslateX.value = withTiming(0, { duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInviteStep, showSuccess]);

  // Animated style for success view
  const successAnimatedStyle = useAnimatedStyle(() => ({
    opacity: successOpacity.value,
    transform: [{ scale: successScale.value }],
  }));

  // Animated style for post-success container (horizontal slide)
  const postSuccessAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: postSuccessTranslateX.value }],
  }));

  // Success and Invite steps - horizontal slide animation between them
  if (showSuccess && successMatchId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        <Animated.View
          style={[
            styles.postSuccessContainer,
            { width: SCREEN_WIDTH * 2 },
            postSuccessAnimatedStyle,
          ]}
        >
          {/* Success Step */}
          <View style={[styles.postSuccessStep, { width: SCREEN_WIDTH }]}>
            <Animated.View style={[styles.successContainer, successAnimatedStyle]}>
              {/* Close button */}
              <TouchableOpacity
                onPress={() => {
                  lightHaptic();
                  onClose();
                }}
                style={[
                  styles.successCloseButton,
                  { backgroundColor: isDark ? neutral[800] : neutral[100] },
                ]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-outline" size={20} color={colors.textMuted} />
              </TouchableOpacity>

              <View style={[styles.successIcon, { backgroundColor: colors.buttonActive }]}>
                <Ionicons
                  name={isEditMode ? 'checkmark-circle' : 'trophy'}
                  size={48}
                  color={BASE_WHITE}
                />
              </View>
              <Text size="xl" weight="bold" color={colors.text} style={styles.successTitle}>
                {isEditMode ? t('matchCreation.updateSuccess') : t('matchCreation.success')}
              </Text>
              <Text size="base" color={colors.textMuted} style={styles.successDescription}>
                {isEditMode
                  ? t('matchCreation.updateSuccessDescription')
                  : t('matchCreation.successDescription')}
              </Text>
              <View style={styles.successButtons}>
                {/* Share button - first */}
                <TouchableOpacity
                  style={[
                    styles.successButton,
                    {
                      backgroundColor: secondary[500],
                    },
                  ]}
                  onPress={handleShareSuccess}
                  disabled={isSharing}
                >
                  {isSharing ? (
                    <ActivityIndicator color={base.white} size="small" />
                  ) : (
                    <>
                      <Ionicons
                        name="share-social"
                        size={18}
                        color={base.white}
                        style={styles.buttonIcon}
                      />
                      <Text size="base" weight="semibold" color={base.white}>
                        {t('matchDetail.inviteFriends')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                {/* Invite Players button - only for new matches */}
                {!isEditMode && (
                  <TouchableOpacity
                    style={[styles.successButton, { backgroundColor: colors.buttonActive }]}
                    onPress={() => {
                      lightHaptic();
                      setShowInviteStep(true);
                    }}
                  >
                    <Ionicons
                      name="people-outline"
                      size={20}
                      color={colors.buttonTextActive}
                      style={styles.buttonIcon}
                    />
                    <Text size="base" weight="semibold" color={colors.buttonTextActive}>
                      {t('matchCreation.invite.title')}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[
                    styles.successButton,
                    {
                      backgroundColor: isEditMode ? colors.buttonActive : colors.buttonInactive,
                    },
                  ]}
                  onPress={() => onSuccess?.(successMatchId)}
                >
                  <Text
                    size="base"
                    weight="semibold"
                    color={isEditMode ? colors.buttonTextActive : colors.buttonActive}
                  >
                    {t('matchCreation.viewMatch')}
                  </Text>
                </TouchableOpacity>
                {!isEditMode && (
                  <TouchableOpacity
                    style={[styles.successButton, { backgroundColor: 'transparent' }]}
                    onPress={() => {
                      // Reset animations and state for next creation
                      successOpacity.value = 0;
                      successScale.value = 0.8;
                      formOpacity.value = 1;
                      postSuccessTranslateX.value = 0;
                      setShowSuccess(false);
                      setSuccessMatchId(null);
                      setShowInviteStep(false);
                      resetForm();
                      setCurrentStep(1);
                      setHighestStepVisited(1);
                    }}
                  >
                    <Text size="base" weight="regular" color={colors.textSecondary}>
                      {t('matchCreation.createAnother')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          </View>

          {/* Player Invite Step */}
          <View style={[styles.postSuccessStep, { width: SCREEN_WIDTH }]}>
            {selectedSport?.id && session?.user?.id && (
              <PlayerInviteStep
                matchId={successMatchId}
                sportId={selectedSport.id}
                hostId={session.user.id}
                onComplete={() => {
                  // Close invite step and go to match detail
                  onSuccess?.(successMatchId);
                }}
                colors={{
                  ...colors,
                  background: colors.cardBackground,
                }}
                t={t}
                isDark={isDark}
                showCloseButton
              />
            )}
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      {/* Header */}
      <WizardHeader
        currentStep={currentStep}
        onBack={goToPrevStep}
        onBackToLanding={onBackToLanding}
        onClose={handleClose}
        sportName={selectedSport?.display_name ?? 'Sport'}
        sportKey={selectedSport?.name}
        colors={colors}
        t={t}
      />

      {/* Progress bar */}
      <ProgressBar currentStep={currentStep} totalSteps={TOTAL_STEPS} colors={colors} t={t} />

      {/* Step content (button navigation only) */}
      <View style={styles.stepsViewport}>
        <Animated.View
          style={[styles.stepsContainer, { width: SCREEN_WIDTH * TOTAL_STEPS }, animatedStepStyle]}
        >
          {/* Step 1: Where */}
          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            <WhereStep
              form={form}
              colors={colors}
              t={t}
              isDark={isDark}
              sportId={selectedSport?.id}
              sportName={selectedSport?.name}
              deviceTimezone={timezone}
              onSlotBooked={handleSlotBooked}
              preferredFacilityId={preferredFacilityId}
              editMatch={editMatch}
            />
          </View>

          {/* Step 2: When (lazy mounted) */}
          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            {highestStepVisited >= 2 && (
              <WhenFormatStep
                form={form}
                colors={colors}
                t={t}
                isDark={isDark}
                locale={locale}
                isLocked={bookedSlotData !== null}
              />
            )}
          </View>

          {/* Step 3: Preferences (lazy mounted) */}
          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            {highestStepVisited >= 3 && (
              <PreferencesStep
                form={form}
                colors={colors}
                t={t}
                isDark={isDark}
                sportName={selectedSport?.name}
                sportId={selectedSport?.id}
                userId={session?.user?.id}
              />
            )}
          </View>
        </Animated.View>
      </View>

      {/* Navigation buttons */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {currentStep < TOTAL_STEPS ? (
          <TouchableOpacity
            style={[styles.nextButton, { backgroundColor: colors.buttonActive }]}
            onPress={goToNextStep}
            accessibilityLabel={t('matchCreation.accessibility.nextStep')}
            accessibilityRole="button"
          >
            <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
              {t('matchCreation.next')}
            </Text>
            <Ionicons name="arrow-forward-outline" size={20} color={colors.buttonTextActive} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.nextButton,
              { backgroundColor: colors.buttonActive },
              isSubmitting && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            accessibilityLabel={
              isEditMode ? t('matchCreation.saveChanges') : t('matchCreation.createMatch')
            }
            accessibilityRole="button"
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.buttonTextActive} />
            ) : (
              <>
                <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
                  {isEditMode ? t('matchCreation.saveChanges') : t('matchCreation.createMatch')}
                </Text>
                <Ionicons name="checkmark-outline" size={20} color={colors.buttonTextActive} />
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  headerButtonPlaceholder: {
    width: 24,
  },
  sportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1.5],
  },
  progressContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  progressBarBg: {
    height: 4,
    borderRadius: radiusPixels.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radiusPixels.full,
  },
  stepsViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  stepsContainer: {
    flexDirection: 'row',
    flex: 1,
    height: '100%',
  },
  stepWrapper: {
    height: '100%',
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[8],
  },
  nextButton: {
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
  postSuccessContainer: {
    flexDirection: 'row',
    flex: 1,
  },
  postSuccessStep: {
    flex: 1,
    height: '100%',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
    paddingBottom: spacingPixels[4],
    position: 'relative',
  },
  successCloseButton: {
    position: 'absolute',
    top: spacingPixels[4],
    right: spacingPixels[4],
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  successTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  successDescription: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  successButtons: {
    gap: spacingPixels[3],
    width: '100%',
  },
  successButton: {
    flexDirection: 'row',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  buttonIcon: {
    marginRight: spacingPixels[1],
  },
});

export default MatchCreationWizard;
