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
import type { DayEnum } from '@rallia/shared-types';

import * as Analytics from '#/services/analytics';

import {
  useAvailabilityKeys,
  useCheckInContext,
  useRecordCheckIn,
  type CheckInContext,
  type CheckInResult,
  type HourGrid,
} from './api';
import { countCellsForDays } from './window';

// Analytics step labels, keyed by step index. The streak recap leads as the
// motivational hook, then the schedule, then the auto-match planning step —
// which gets its own step so players actually see (and consciously opt into)
// the auto-create/auto-invite behaviour.
const STEP_NAMES: Record<WizardStep, string> = {
  1: 'recap_goal',
  2: 'availability',
  3: 'auto_match',
  4: 'all_set',
};

// Shared with apps/mobile/src/screens/Home.tsx (AVAILABILITY_BANNER_COOLDOWN_KEY).
// Dismissing the home availability banner sets this; the auto-opener reads it to
// avoid nagging right after a dismissal.
export const WEEKLY_CHECKIN_COOLDOWN_KEY = '@rallia/availability-refresh-banner-cooldown';

// The rolling check-in only edits a 4-day window, so the floor is lower than
// onboarding's 6/week — a few slots across the window is enough for the
// match-creation logic to have something to work with.
export const MIN_AVAILABILITY_CELLS = 3;

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

  // Form state — Step 1 frequency goal
  frequencyGoal: number;
  setFrequencyGoal: (n: number) => void;

  // Form state — Step 2 availability
  availability: HourGrid;
  setAvailability: (next: HourGrid) => void;
  availabilityLoading: boolean;
  // Form state — Step 3 auto-match opt-ins
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

  /** The window's weekdays (today + next 3), from the server context. */
  windowDays: DayEnum[];
  /** Selected cells within the window — the real gate for the availability CTA. */
  windowCellCount: number;
  /**
   * The goal was already set this ISO week, so the recap+goal step is skipped
   * entirely — the wizard opens on availability and back stops there. Drives
   * the header's step numbering (3 dots instead of 4).
   */
  skipRecapStep: boolean;

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

  // Server-computed rolling window (today + next 3) → the weekdays we edit.
  const windowDays = useMemo<DayEnum[]>(
    () => (context?.window ?? []).map(w => w.dayOfWeek),
    [context?.window]
  );
  // The availability step gates on cells WITHIN the window — the seeded set
  // also holds the player's other-day availability, which must not count
  // toward the minimum.
  const windowCellCount = useMemo(
    () => countCellsForDays(availability, windowDays),
    [availability, windowDays]
  );
  // The weekly objective is asked once per ISO week. Once it's set, the whole
  // recap+goal step is skipped — a re-opened wizard (rolling availability
  // coverage ran out mid-week) goes straight to the availability step instead
  // of replaying a recap with nothing to decide.
  const skipRecapStep = !!context?.frequencyAlreadySetThisWeek;

  // Jump past the recap step once the context lands (only if the user is still
  // sitting on step 1, which they are — step 1 shows a loader until context).
  const skipDecidedRef = useRef(false);
  useEffect(() => {
    if (skipDecidedRef.current || !context) return;
    skipDecidedRef.current = true;
    if (context.frequencyAlreadySetThisWeek) {
      setCurrentStep(prev => (prev === 1 ? 2 : prev));
    }
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
    // Funnel step_completed for the step being left. Steps 1 (recap_goal) and
    // 2 (availability) advance via goNext; step 3 (auto_match) completes via submit().
    if (currentStep === 1) {
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[1],
        step_index: 1,
        frequency_goal: frequencyGoal,
      });
    } else if (currentStep === 2) {
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[2],
        step_index: 2,
        availability_cells: availability.size,
      });
    }
    setCurrentStep(prev => (prev < TOTAL_STEPS ? ((prev + 1) as WizardStep) : prev));
    mediumHaptic();
  }, [currentStep, availability, frequencyGoal]);
  const goBack = useCallback(() => {
    // When the recap step is skipped, availability (step 2) is the floor.
    const minStep = skipRecapStep ? 2 : 1;
    setCurrentStep(prev => (prev > minStep ? ((prev - 1) as WizardStep) : prev));
  }, [skipRecapStep]);

  // Validation — step 1 (recap + goal) gates on a valid frequency (defaults are
  // valid). Step 2 (availability) gates on ≥ MIN_AVAILABILITY_CELLS.
  // Step 3 (auto-match) is always valid — both opt-in states are submittable.
  // Step 4 has no CTA — it's the success state.
  const canAdvance = useMemo(() => {
    switch (currentStep) {
      case 1:
        return frequencyGoal >= 1 && frequencyGoal <= 5;
      case 2:
        return windowCellCount >= MIN_AVAILABILITY_CELLS;
      case 3:
        return true;
      case 4:
        return false; // no advance from the success step
      default:
        return false;
    }
  }, [currentStep, windowCellCount, frequencyGoal]);

  // Submit handler — called when the user taps the CTA on the auto-match step.
  // Runs the availability save + RPC, then advances to the All-Set step.
  const submit = useCallback(async () => {
    try {
      const res = await recordCheckIn({
        frequencyGoal,
        autoCreate,
        autoInvite,
        availability,
        windowDays,
      });
      // The auto-match step (step 3) completes on a successful submit.
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[3],
        step_index: 3,
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
  }, [recordCheckIn, frequencyGoal, autoCreate, autoInvite, availability, windowDays, onComplete]);

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

    windowDays,
    windowCellCount,
    skipRecapStep,

    // Epoch ms when the wizard opened — for analytics duration on completion.
    startedAt: startedAtRef.current,
  };
}
