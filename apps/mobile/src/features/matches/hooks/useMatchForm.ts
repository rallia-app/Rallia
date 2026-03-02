/**
 * useMatchForm Hook
 * Manages match creation form state with react-hook-form and zod validation.
 * Provides smart defaults, per-step validation, and form persistence.
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import { useForm, useWatch, UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  matchFormSchema,
  type MatchFormSchemaData,
  type Step1FormData,
  type Step2FormData,
  type Step3FormData,
  type MatchWithDetails,
  type MatchFormatEnum,
  type LocationTypeEnum,
  type MatchVisibilityEnum,
  type MatchJoinModeEnum,
  type GenderEnum,
  type CourtStatusEnum,
  type CostSplitTypeEnum,
  type MatchTypeEnum,
} from '@rallia/shared-types';

/**
 * Format a date as YYYY-MM-DD in local time (not UTC)
 */
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get smart default values for the form
 */
function getDefaultValues(sportId: string, timezone: string): MatchFormSchemaData {
  // Get the next rounded hour for start time
  const now = new Date();
  const currentHour = now.getHours();

  // Calculate start time (next rounded hour)
  const startTime = new Date(now);
  startTime.setHours(currentHour + 1);
  startTime.setMinutes(0);
  startTime.setSeconds(0);
  startTime.setMilliseconds(0);

  // Use the start time's date (handles midnight rollover correctly)
  // If current hour is 23, startTime will be 00:00 of the next day
  const matchDateStr = formatDateLocal(startTime);
  const startTimeStr = startTime.toTimeString().slice(0, 5);

  // Calculate end time (1 hour after start)
  const endTime = new Date(startTime);
  endTime.setHours(endTime.getHours() + 1);
  const endTimeStr = endTime.toTimeString().slice(0, 5);

  return {
    // Sport (from context)
    sportId,

    // Step 1: When & Format
    matchDate: matchDateStr,
    startTime: startTimeStr,
    endTime: endTimeStr,
    timezone, // IANA timezone (auto-detected)
    duration: '60',
    customDurationMinutes: undefined,
    format: 'singles',
    playerExpectation: 'both',

    // Step 2: Where
    locationType: 'facility',
    facilityId: undefined,
    courtId: undefined,
    locationName: undefined,
    locationAddress: undefined,
    customLatitude: undefined,
    customLongitude: undefined,

    // Step 3: Preferences
    courtStatus: undefined,
    isCourtFree: true,
    costSplitType: 'equal',
    estimatedCost: undefined,
    minRatingScoreId: undefined,
    preferredOpponentGender: undefined,
    visibility: 'public',
    visibleInGroups: true,
    visibleInCommunities: true,
    joinMode: 'direct',
    notes: undefined,
  };
}

/**
 * Calculate end time from start time and duration
 */
export function calculateEndTime(
  startTime: string,
  duration: string,
  customMinutes?: number
): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const durationMinutes = duration === 'custom' ? (customMinutes ?? 60) : parseInt(duration, 10);

  const endDate = new Date();
  endDate.setHours(hours);
  endDate.setMinutes(minutes + durationMinutes);

  return endDate.toTimeString().slice(0, 5);
}

/**
 * Calculate duration from start and end times
 * Returns the closest standard duration or 'custom' if not standard
 */
function calculateDurationFromTimes(
  startTime: string,
  endTime: string
): { duration: MatchFormSchemaData['duration']; customMinutes?: number } {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const diffMinutes = endMinutes - startMinutes;

  // Check for standard durations
  const standardDurations = ['30', '60', '90', '120'] as const;
  for (const d of standardDurations) {
    if (diffMinutes === parseInt(d, 10)) {
      return { duration: d };
    }
  }

  // Non-standard duration
  return { duration: 'custom', customMinutes: diffMinutes > 0 ? diffMinutes : 60 };
}

/**
 * Convert a Match object to form data for editing
 * Maps database field names to form field names
 */
export function matchToFormData(
  match: MatchWithDetails,
  timezone: string
): Partial<MatchFormSchemaData> {
  // Map DB court_status values to form values
  const courtStatusMap: Record<CourtStatusEnum, MatchFormSchemaData['courtStatus']> = {
    reserved: 'booked',
    to_reserve: 'to_book',
  };

  // Map DB cost_split_type values to form values
  const costSplitMap: Record<CostSplitTypeEnum, MatchFormSchemaData['costSplitType']> = {
    host_pays: 'creator_pays',
    split_equal: 'equal',
    custom: 'custom',
  };

  // Map DB player_expectation values to form values
  // Handle both legacy 'practice' and new 'casual' values for backward compatibility
  const playerExpectationMap: Record<string, MatchTypeEnum> = {
    casual: 'casual',
    practice: 'casual', // Legacy value mapping
    competitive: 'competitive',
    both: 'both',
  };

  // Use stored duration if available, otherwise calculate from start/end times
  let duration: MatchFormSchemaData['duration'];
  let customMinutes: number | undefined;

  if (match.duration) {
    // Use the stored duration value directly (enum values match form values)
    duration = match.duration as MatchFormSchemaData['duration'];
    customMinutes = match.custom_duration_minutes ?? undefined;
  } else {
    // Fallback: calculate from start/end times for legacy matches
    const calculated = calculateDurationFromTimes(match.start_time, match.end_time);
    duration = calculated.duration;
    customMinutes = calculated.customMinutes;
  }

  return {
    sportId: match.sport_id,
    matchDate: match.match_date,
    startTime: match.start_time,
    endTime: match.end_time,
    timezone: match.timezone || timezone,
    duration,
    customDurationMinutes: customMinutes,
    format: (match.format as MatchFormatEnum) || 'singles',
    playerExpectation: match.player_expectation
      ? playerExpectationMap[match.player_expectation] || 'both'
      : 'both',
    locationType: (match.location_type as LocationTypeEnum) || 'tbd',
    facilityId: match.facility_id || undefined,
    courtId: match.court_id || undefined,
    locationName: match.location_name || undefined,
    locationAddress: match.location_address || undefined,
    // Custom location coordinates
    customLatitude: match.custom_latitude != null ? Number(match.custom_latitude) : undefined,
    customLongitude: match.custom_longitude != null ? Number(match.custom_longitude) : undefined,
    courtStatus: match.court_status ? courtStatusMap[match.court_status] : undefined,
    isCourtFree: match.is_court_free ?? true,
    costSplitType: match.cost_split_type ? costSplitMap[match.cost_split_type] || 'equal' : 'equal',
    estimatedCost: match.estimated_cost ?? undefined,
    minRatingScoreId: match.min_rating_score_id || undefined,
    preferredOpponentGender: match.preferred_opponent_gender as GenderEnum | 'any' | undefined,
    visibility: (match.visibility as MatchVisibilityEnum) || 'public',
    visibleInGroups: match.visible_in_groups ?? true,
    visibleInCommunities: match.visible_in_communities ?? true,
    joinMode: (match.join_mode as MatchJoinModeEnum) || 'direct',
    notes: match.notes || undefined,
  };
}

interface UseMatchFormOptions {
  /** Sport ID from context */
  sportId: string;
  /** IANA timezone identifier (e.g., "America/New_York") */
  timezone: string;
  /** Initial values (e.g., from draft) */
  initialValues?: Partial<MatchFormSchemaData>;
}

interface UseMatchFormReturn {
  /** The react-hook-form instance */
  form: UseFormReturn<MatchFormSchemaData>;
  /** Current form values */
  values: MatchFormSchemaData;
  /** Whether the form is dirty (has changes) */
  isDirty: boolean;
  /** Validate a specific step */
  validateStep: (step: 1 | 2 | 3) => Promise<boolean>;
  /** Get step-specific errors */
  getStepErrors: (step: 1 | 2 | 3) => Record<string, string>;
  /** Reset form to defaults */
  resetForm: () => void;
  /** Update form with draft data */
  loadFromDraft: (data: Partial<MatchFormSchemaData>) => void;
  /** Get data for a specific step */
  getStepData: (step: 1 | 2 | 3) => Step1FormData | Step2FormData | Step3FormData;
}

/**
 * Hook for managing match creation form state
 *
 * @example
 * ```tsx
 * const { form, validateStep, getStepErrors } = useMatchForm({
 *   sportId: selectedSport.id,
 * });
 *
 * // In step component
 * const { register, formState: { errors } } = form;
 *
 * // On next button click
 * const handleNext = async () => {
 *   const isValid = await validateStep(currentStep);
 *   if (isValid) {
 *     goToNextStep();
 *   }
 * };
 * ```
 */
export function useMatchForm(options: UseMatchFormOptions): UseMatchFormReturn {
  const { sportId, timezone, initialValues } = options;

  // Merge defaults with initial values
  const defaultValues = useMemo(() => {
    const defaults = getDefaultValues(sportId, timezone);
    if (initialValues) {
      return {
        ...defaults,
        ...initialValues,
        sportId,
        timezone: initialValues.timezone || timezone,
      };
    }
    return defaults;
  }, [sportId, timezone, initialValues]);

  // Initialize react-hook-form with zod resolver
  const form = useForm<MatchFormSchemaData>({
    resolver: zodResolver(matchFormSchema),
    defaultValues,
    mode: 'onChange',
  });

  const { trigger, formState, reset, setValue } = form;
  const values = useWatch({ control: form.control }) as MatchFormSchemaData;

  // Reset form when sportId changes (handles sport switching)
  // Use a ref to track the previous sportId and only reset on actual changes
  const prevSportIdRef = useRef(sportId);
  useEffect(() => {
    if (prevSportIdRef.current !== sportId) {
      prevSportIdRef.current = sportId;
      // Reset to new defaults when sport changes
      reset(getDefaultValues(sportId, timezone));
    }
  }, [sportId, timezone, reset]);

  // Validate a specific step
  const validateStep = useCallback(
    async (step: 1 | 2 | 3): Promise<boolean> => {
      const stepFields = getStepFields(step);
      const result = await trigger(stepFields);
      return result;
    },
    [trigger]
  );

  // Get errors for a specific step
  const getStepErrors = useCallback(
    (step: 1 | 2 | 3): Record<string, string> => {
      const stepFields = getStepFields(step);
      const errors: Record<string, string> = {};

      stepFields.forEach(field => {
        const error = formState.errors[field];
        if (error?.message) {
          errors[field] = error.message as string;
        }
      });

      return errors;
    },
    [formState.errors]
  );

  // Reset form to defaults
  const resetForm = useCallback(() => {
    reset(getDefaultValues(sportId, timezone));
  }, [reset, sportId, timezone]);

  // Load data from draft
  const loadFromDraft = useCallback(
    (data: Partial<MatchFormSchemaData>) => {
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined) {
          setValue(
            key as keyof MatchFormSchemaData,
            value as MatchFormSchemaData[keyof MatchFormSchemaData]
          );
        }
      });
    },
    [setValue]
  );

  // Get data for a specific step
  // Order: Step 1 = Where, Step 2 = When, Step 3 = Preferences
  const getStepData = useCallback(
    (step: 1 | 2 | 3): Step1FormData | Step2FormData | Step3FormData => {
      switch (step) {
        case 1:
          // Step 1: Where
          return {
            locationType: values.locationType,
            facilityId: values.facilityId,
            courtId: values.courtId,
            locationName: values.locationName,
            locationAddress: values.locationAddress,
            customLatitude: values.customLatitude,
            customLongitude: values.customLongitude,
          } as Step1FormData;
        case 2:
          // Step 2: When
          return {
            matchDate: values.matchDate,
            startTime: values.startTime,
            duration: values.duration,
            customDurationMinutes: values.customDurationMinutes,
            timezone: values.timezone,
          } as Step2FormData;
        case 3:
          // Step 3: Preferences (includes format and player expectation)
          return {
            format: values.format,
            playerExpectation: values.playerExpectation,
            courtStatus: values.courtStatus,
            isCourtFree: values.isCourtFree,
            costSplitType: values.costSplitType,
            estimatedCost: values.estimatedCost,
            visibility: values.visibility,
            visibleInGroups: values.visibleInGroups,
            visibleInCommunities: values.visibleInCommunities,
            joinMode: values.joinMode,
            notes: values.notes,
          } as Step3FormData;
        default:
          return {} as Step1FormData;
      }
    },
    [values]
  );

  return {
    form,
    values,
    isDirty: formState.isDirty,
    validateStep,
    getStepErrors,
    resetForm,
    loadFromDraft,
    getStepData,
  };
}

/**
 * Get the field names for a specific step
 * Order: Step 1 = Where, Step 2 = When, Step 3 = Preferences (includes format/expectation)
 */
function getStepFields(step: 1 | 2 | 3): (keyof MatchFormSchemaData)[] {
  switch (step) {
    case 1:
      // Step 1: Where
      return [
        'locationType',
        'facilityId',
        'courtId',
        'locationName',
        'locationAddress',
        'customLatitude',
        'customLongitude',
      ];
    case 2:
      // Step 2: When (date, time, duration, timezone only - format/expectation moved to step 3)
      return ['matchDate', 'startTime', 'duration', 'customDurationMinutes', 'timezone'];
    case 3:
      // Step 3: Preferences (includes format and player expectation)
      return [
        'format',
        'playerExpectation',
        'courtStatus',
        'isCourtFree',
        'costSplitType',
        'estimatedCost',
        'visibility',
        'visibleInGroups',
        'visibleInCommunities',
        'joinMode',
        'notes',
      ];
    default:
      return [];
  }
}

export default useMatchForm;
