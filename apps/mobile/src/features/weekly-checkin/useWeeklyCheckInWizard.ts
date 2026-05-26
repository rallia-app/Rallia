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
 * The cooldown AsyncStorage key is shared with the home banner so dismissing
 * via the wizard's discrete × ALSO suppresses the banner for 24h.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  errorHaptic,
  mediumHaptic,
  selectionHaptic,
  successHaptic,
  warningHaptic,
} from '@rallia/shared-utils';
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

// Analytics step labels, keyed by step index.
const STEP_NAMES: Record<WizardStep, string> = {
  1: 'welcome_recap',
  2: 'availability',
  3: 'frequency_auto',
  4: 'all_set',
};

// Shared with apps/mobile/src/screens/Home.tsx (AVAILABILITY_BANNER_COOLDOWN_KEY).
// Dismissing either the banner OR the wizard sets this — they're a unified
// "user is choosing not to engage right now" signal.
export const WEEKLY_CHECKIN_COOLDOWN_KEY = '@rallia/availability-refresh-banner-cooldown';

// Same as MIN_AVAILABILITIES in onboarding — the wizard requires at least
// 6 free hours per week so the match-creation logic has something to work with.
export const MIN_AVAILABILITY_CELLS = 6;

export type WizardStep = 1 | 2 | 3 | 4;
const TOTAL_STEPS: WizardStep = 4;

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

  // Exit-confirmation flow
  exitPromptVisible: boolean;
  requestExit: () => void;
  cancelExit: () => void;
  confirmExit: () => Promise<void>;

  /** Epoch ms when the wizard opened (analytics duration). */
  startedAt: number;
}

interface UseWeeklyCheckInWizardOptions {
  /** Called when the user successfully completes the wizard. */
  onComplete?: (result: CheckInResult) => void;
  /** Called when the user dismisses via the × (after confirmation). */
  onDismiss?: () => void;
}

export function useWeeklyCheckInWizard(
  options: UseWeeklyCheckInWizardOptions = {}
): UseWeeklyCheckInWizard {
  const { onComplete, onDismiss } = options;

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

  // Exit confirmation
  const [exitPromptVisible, setExitPromptVisible] = useState(false);

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
    // Funnel step_completed for the step being left. Step 3 (frequency_auto)
    // completes via submit(), not goNext.
    if (currentStep === 1) {
      Analytics.weeklyCheckinStepCompleted({ step_name: STEP_NAMES[1], step_index: 1 });
    } else if (currentStep === 2) {
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[2],
        step_index: 2,
        availability_cells: availability.size,
      });
    }
    setCurrentStep(prev => (prev < TOTAL_STEPS ? ((prev + 1) as WizardStep) : prev));
    mediumHaptic();
  }, [currentStep, availability]);
  const goBack = useCallback(() => {
    setCurrentStep(prev => (prev > 1 ? ((prev - 1) as WizardStep) : prev));
  }, []);

  // Validation — only step 2 has a non-trivial gate (≥ MIN_AVAILABILITY_CELLS).
  // Step 1 always advances. Step 3 always advances (defaults are valid).
  // Step 4 has no CTA — it's the success state.
  const canAdvance = useMemo(() => {
    switch (currentStep) {
      case 1:
        return true;
      case 2:
        return availability.size >= MIN_AVAILABILITY_CELLS;
      case 3:
        return frequencyGoal >= 1 && frequencyGoal <= 5;
      case 4:
        return false; // no advance from the success step
      default:
        return false;
    }
  }, [currentStep, availability.size, frequencyGoal]);

  // Submit handler — called when the user taps Continue on Step 3.
  // Runs the availability save + RPC, then advances to Step 4 with the result.
  const submit = useCallback(async () => {
    try {
      const res = await recordCheckIn({
        frequencyGoal,
        autoCreate,
        autoInvite,
        availability,
      });
      // Step 3 completes on a successful submit (not via goNext).
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[3],
        step_index: 3,
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
      setCurrentStep(4);
      onComplete?.(res);
    } catch (err) {
      errorHaptic();
      Analytics.weeklyCheckinSubmitFailed({ error: (err as Error)?.message ?? 'unknown' });
      Logger.error('Weekly check-in submit failed', err as Error);
      throw err;
    }
  }, [recordCheckIn, frequencyGoal, autoCreate, autoInvite, availability, onComplete]);

  // Exit flow — discrete × → confirmation → cooldown + dismiss.
  // Haptics signal the weight of each step: selection "tick" on cancel
  // (decision reversed) and warning "are you sure?" weight on confirm-dismiss.
  // requestExit's tap haptic is fired by the WizardHeader × button itself
  // (same pattern as the back chevron).
  const requestExit = useCallback(() => {
    setExitPromptVisible(true);
  }, []);
  const cancelExit = useCallback(() => {
    selectionHaptic();
    setExitPromptVisible(false);
  }, []);
  const confirmExit = useCallback(async () => {
    warningHaptic();
    Analytics.weeklyCheckinAbandoned({
      last_step: STEP_NAMES[currentStep],
      step_index: currentStep,
      duration_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
    });
    try {
      await AsyncStorage.setItem(WEEKLY_CHECKIN_COOLDOWN_KEY, Date.now().toString());
    } catch (err) {
      Logger.error('Weekly check-in: failed to set cooldown', err as Error);
    }
    setExitPromptVisible(false);
    onDismiss?.();
  }, [onDismiss, currentStep]);

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

    exitPromptVisible,
    requestExit,
    cancelExit,
    confirmExit,

    // Epoch ms when the wizard opened — for analytics duration on completion.
    startedAt: startedAtRef.current,
  };
}
