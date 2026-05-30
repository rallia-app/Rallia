/**
 * Weekly Check-In Wizard — state hook
 *
 * Single source of truth for the wizard's step navigation, form values,
 * cold-start context (loaded from get_check_in_context), and submission.
 *
 * Mirrors the shape of `useOnboardingWizard.ts` but is intentionally simpler:
 * fixed 4 steps, no dynamic step list, no per-step validators beyond
 * "frequency 1..5" and "availability has ≥ MIN_SELECTIONS cells".
 *
 * The check-in is mandatory — there is no exit path. The wizard leaves the
 * screen only on completion (the route's dismiss callback runs from the final
 * step). The cooldown key below is still exported for the home banner / auto-
 * opener, which use it independently.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorHaptic, mediumHaptic, selectionHaptic, successHaptic } from '@rallia/shared-utils';
import { Logger } from '@rallia/shared-services';

import * as Analytics from '#/services/analytics';

import {
  useAvailabilityKeys,
  useCheckInContext,
  useRecordCheckIn,
  type CheckInContext,
  type CheckInResult,
  type HourGrid,
} from './api';

// Analytics step labels, keyed by step index. Availability leads so the player
// updates their schedule first (the wizard's primary goal); the recap + goal
// are merged into one step to keep the wizard short.
const STEP_NAMES: Record<WizardStep, string> = {
  1: 'availability',
  2: 'recap_goal',
  3: 'all_set',
};

// Shared with apps/mobile/src/screens/Home.tsx (AVAILABILITY_BANNER_COOLDOWN_KEY).
// Dismissing the home availability banner sets this; the auto-opener reads it to
// avoid nagging right after a dismissal.
export const WEEKLY_CHECKIN_COOLDOWN_KEY = '@rallia/availability-refresh-banner-cooldown';

// Same as MIN_AVAILABILITIES in onboarding — the wizard requires at least
// 6 free hours per week so the match-creation logic has something to work with.
export const MIN_AVAILABILITY_CELLS = 6;

export type WizardStep = 1 | 2 | 3;
const TOTAL_STEPS: WizardStep = 3;

export interface UseWeeklyCheckInWizard {
  // Step navigation
  currentStep: WizardStep;
  totalSteps: WizardStep;
  goNext: () => void;
  goBack: () => void;
  goToStep: (step: WizardStep) => void;

  // Cold-start context (streak + last week recap + goals history)
  context: CheckInContext | null;
  isContextLoading: boolean;
  contextError: Error | null;

  // Form state — Step 2 availability
  availability: HourGrid;
  setAvailability: (next: HourGrid) => void;
  availabilityLoading: boolean;

  // Form state — Step 3 frequency + opt-ins
  frequencyGoal: number;
  setFrequencyGoal: (n: number) => void;
  autoCreate: boolean;
  setAutoCreate: (b: boolean) => void;
  autoInvite: boolean;
  setAutoInvite: (b: boolean) => void;

  // Submission
  submit: () => Promise<void>;
  isSubmitting: boolean;
  result: CheckInResult | null;

  // Validation per step (gates the Continue CTA)
  canAdvance: boolean;

  /** Epoch ms when the wizard opened (analytics duration). */
  startedAt: number;
}

interface UseWeeklyCheckInWizardOptions {
  /** Called when the user successfully completes the wizard. */
  onComplete?: (result: CheckInResult) => void;
}

export function useWeeklyCheckInWizard(
  options: UseWeeklyCheckInWizardOptions = {}
): UseWeeklyCheckInWizard {
  const { onComplete } = options;

  // Step navigation
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // Load cold-start data
  const {
    data: context = null,
    isLoading: isContextLoading,
    error: contextError,
  } = useCheckInContext();
  const { data: initialKeys, isLoading: availabilityLoading } = useAvailabilityKeys();

  // Form state — seeded from loaded data once available
  const [availability, setAvailability] = useState<HourGrid>(() => new Set());
  const [frequencyGoal, setFrequencyGoalState] = useState<number>(3);
  const [autoCreate, setAutoCreateState] = useState<boolean>(true);
  const [autoInvite, setAutoInviteState] = useState<boolean>(true);

  // When the wizard opened — drives duration_seconds on completed/abandoned.
  const startedAtRef = useRef(Date.now());

  // Seed availability from the fetched key list (once, on first load).
  // initialKeys is a string[] — see api.ts for why it's not a Set.
  //
  // We build the Set via an index loop instead of `new Set(initialKeys)`
  // because Hermes occasionally throws "iterator method is not callable"
  // when constructing a Set from an array that came through TanStack
  // Query's structural-sharing pass. Index access doesn't touch
  // [Symbol.iterator], so it's iron-clad.
  const seededAvailability = useRef(false);
  useEffect(() => {
    if (seededAvailability.current) return;
    if (!initialKeys) return;
    if (!Array.isArray(initialKeys)) return;
    const seeded = new Set<string>();
    for (let i = 0; i < initialKeys.length; i++) {
      seeded.add(initialKeys[i]);
    }
    setAvailability(seeded);
    seededAvailability.current = true;
  }, [initialKeys]);

  // Seed frequency from the player's last goal (or last week's), default 3.
  const seededFrequency = useRef(false);
  useEffect(() => {
    if (seededFrequency.current) return;
    if (!context) return;
    const initial = context.lastFrequencyGoal ?? context.lastWeekFrequencyGoal ?? 3;
    setFrequencyGoalState(Math.max(1, Math.min(5, initial)));
    seededFrequency.current = true;
  }, [context]);

  // Submission
  const { mutateAsync: recordCheckIn, isPending: isSubmitting } = useRecordCheckIn();
  const [result, setResult] = useState<CheckInResult | null>(null);

  // Setters with light haptics on user interaction.
  const setFrequencyGoal = useCallback((n: number) => {
    selectionHaptic();
    setFrequencyGoalState(Math.max(1, Math.min(5, n)));
  }, []);
  const setAutoCreate = useCallback((b: boolean) => {
    selectionHaptic();
    setAutoCreateState(b);
  }, []);
  const setAutoInvite = useCallback((b: boolean) => {
    selectionHaptic();
    setAutoInviteState(b);
  }, []);

  // Navigation
  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
  }, []);
  const goNext = useCallback(() => {
    // Funnel step_completed for the step being left. Only step 1 (availability)
    // advances via goNext; step 2 (recap_goal) completes via submit().
    if (currentStep === 1) {
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[1],
        step_index: 1,
        availability_cells: availability.size,
      });
    }
    setCurrentStep(prev => (prev < TOTAL_STEPS ? ((prev + 1) as WizardStep) : prev));
    mediumHaptic();
  }, [currentStep, availability]);
  const goBack = useCallback(() => {
    setCurrentStep(prev => (prev > 1 ? ((prev - 1) as WizardStep) : prev));
  }, []);

  // Validation — step 1 (availability) gates on ≥ MIN_AVAILABILITY_CELLS.
  // Step 2 (recap + goal) gates on a valid frequency (defaults are valid).
  // Step 3 has no CTA — it's the success state.
  const canAdvance = useMemo(() => {
    switch (currentStep) {
      case 1:
        return availability.size >= MIN_AVAILABILITY_CELLS;
      case 2:
        return frequencyGoal >= 1 && frequencyGoal <= 5;
      case 3:
        return false; // no advance from the success step
      default:
        return false;
    }
  }, [currentStep, availability.size, frequencyGoal]);

  // Submit handler — called when the user taps the CTA on the recap+goal step.
  // Runs the availability save + RPC, then advances to the All-Set step.
  const submit = useCallback(async () => {
    try {
      const res = await recordCheckIn({
        frequencyGoal,
        autoCreate,
        autoInvite,
        availability,
      });
      // The recap+goal step (step 2) completes on a successful submit.
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[2],
        step_index: 2,
        frequency_goal: frequencyGoal,
        auto_create: autoCreate,
        auto_invite: autoInvite,
      });
      Analytics.weeklyCheckinSubmitted({
        frequency_goal: frequencyGoal,
        availability_cells: availability.size,
        auto_create: autoCreate,
        auto_invite: autoInvite,
        new_streak: res.newStreak,
        milestone_reached: res.milestoneReached,
        freeze_earned: res.freezeEarned,
      });
      setResult(res);
      successHaptic();
      setCurrentStep(3);
      onComplete?.(res);
    } catch (err) {
      errorHaptic();
      Analytics.weeklyCheckinSubmitFailed({ error: (err as Error)?.message ?? 'unknown' });
      Logger.error('Weekly check-in submit failed', err as Error);
      throw err;
    }
  }, [recordCheckIn, frequencyGoal, autoCreate, autoInvite, availability, onComplete]);

  return {
    currentStep,
    totalSteps: TOTAL_STEPS,
    goNext,
    goBack,
    goToStep,

    context,
    isContextLoading,
    contextError: contextError ?? null,

    availability,
    setAvailability,
    availabilityLoading,

    frequencyGoal,
    setFrequencyGoal,
    autoCreate,
    setAutoCreate,
    autoInvite,
    setAutoInvite,

    submit,
    isSubmitting,
    result,

    canAdvance,

    // Epoch ms when the wizard opened — for analytics duration on completion.
    startedAt: startedAtRef.current,
  };
}
