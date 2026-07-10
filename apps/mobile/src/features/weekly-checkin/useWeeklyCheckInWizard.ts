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
import { useQueryClient } from '@tanstack/react-query';
import { errorHaptic, mediumHaptic, selectionHaptic, successHaptic } from '@rallia/shared-utils';
import { Logger } from '@rallia/shared-services';
import type { DayEnum, MatchWithDetails } from '@rallia/shared-types';

import * as Analytics from '#/services/analytics';

import {
  useAvailabilityKeys,
  useCheckInContext,
  useCheckInMatchOpportunities,
  useCheckInMatchPlan,
  useRecordCheckIn,
  checkInKeys,
  type CheckInContext,
  type CheckInMatchPlan,
  type CheckInResult,
  type HourGrid,
  type PlanProposalSubmit,
} from './api';
import { countCellsForDays, slotsForDays } from './window';

// Analytics step labels, keyed by step index. The streak recap leads as the
// motivational hook, then the schedule, then the match plan — a transparent
// preview of exactly which games get created and who gets invited, which the
// player confirms (or trims) before anything happens under their name.
const STEP_NAMES: Record<WizardStep, string> = {
  1: 'recap_goal',
  2: 'availability',
  3: 'match_opportunities',
  4: 'match_plan',
  5: 'all_set',
};

// Shared with apps/mobile/src/screens/Home.tsx (AVAILABILITY_BANNER_COOLDOWN_KEY).
// Dismissing the home availability banner sets this; the auto-opener reads it to
// avoid nagging right after a dismissal.
export const WEEKLY_CHECKIN_COOLDOWN_KEY = '@rallia/availability-refresh-banner-cooldown';

// The rolling check-in only edits a 4-day window, so the floor is lower than
// onboarding's 6/week — a few slots across the window is enough for the
// match-creation logic to have something to work with.
export const MIN_AVAILABILITY_CELLS = 3;

// Match-plan step (step 4) is hidden for now: the wizard submits an empty plan
// (create nothing) straight from "Games for you" — or from availability when
// that step is skipped — and lands on the All-Set recap. Flip to restore.
export const PLAN_STEP_ENABLED: boolean = false;

export type WizardStep = 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS: WizardStep = 5;

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

  // Step 4 — the match plan preview + the player's selection on it.
  plan: CheckInMatchPlan | null;
  planLoading: boolean;
  /** Preview fetch failed — the step falls back to legacy autonomous copy. */
  planError: boolean;
  /** Proposal keys the player removed (arrays, not Sets — Hermes/TanStack). */
  excludedProposalKeys: string[];
  toggleProposal: (key: string) => void;
  /** Disables auto_create_matches — no games are auto-included or created. */
  optOut: boolean;
  setOptOut: (b: boolean) => void;
  /**
   * Screen calls this when a join happens on "Games for you" — the goal cap
   * moved, so the cached plan preview is stale and refetches on the plan step.
   */
  markPlanStale: () => void;

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

  /** "Games for you": public matches fitting the just-declared availability. */
  opportunities: MatchWithDetails[];
  opportunitiesLoading: boolean;
  /**
   * Settled with zero fitting matches → the opportunities step is skipped
   * (no dead screen). Drives both navigation and the header's step numbering.
   */
  skipOpportunitiesStep: boolean;

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

  // Plan selection — everything is INCLUDED by default; these track removals.
  // Arrays (not Sets): Hermes iterator quirk + React state ergonomics.
  const [excludedProposalKeys, setExcludedProposalKeys] = useState<string[]>([]);
  const [optOut, setOptOutState] = useState<boolean>(false);

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

  // "Games for you" — prefetched from the availability step so results are ready
  // by the time the user continues. Slots are the just-declared (in-memory) cells
  // within the window; the query is gated on having any and on the step being
  // reachable (availability or the opportunities step itself).
  const opportunitySlots = useMemo(
    () => slotsForDays(availability, windowDays),
    [availability, windowDays]
  );
  const {
    data: opportunities = [],
    isLoading: opportunitiesIsLoading,
    isFetched: opportunitiesFetched,
  } = useCheckInMatchOpportunities({
    slots: opportunitySlots,
    timezone: context?.timezone,
    enabled: currentStep >= 2 && currentStep <= 3,
  });
  const opportunitiesLoading = opportunitiesIsLoading && opportunitySlots.length > 0;
  // Settled with nothing that fits → skip the step. Only true once the query has
  // actually run for the current slots (isFetched guards the not-yet-run state).
  const skipOpportunitiesStep = opportunitiesFetched && opportunities.length === 0;

  // Match plan preview — enabled from step 3 so it prefetches behind "Games for
  // you" and is warm when the player lands on the plan step. Not enabled on
  // step 2: the query key includes the slots, so grid taps would churn fetches.
  const queryClient = useQueryClient();
  const {
    data: plan = null,
    isLoading: planIsLoading,
    isError: planErrored,
  } = useCheckInMatchPlan({
    slots: opportunitySlots,
    frequencyGoal,
    timezone: context?.timezone,
    // Never fetch while the plan step is hidden — a warm plan would otherwise
    // be silently submitted (games created sight unseen) by submit() below.
    enabled: PLAN_STEP_ENABLED && currentStep >= 3 && currentStep <= 4,
  });
  const planLoading = planIsLoading && opportunitySlots.length > 0;
  const planError = planErrored;

  // Seed the proposals opt-out from the saved preference once the plan lands.
  const seededPlanPrefs = useRef(false);
  useEffect(() => {
    if (seededPlanPrefs.current || !plan) return;
    seededPlanPrefs.current = true;
    if (plan.optedOut) setOptOutState(true);
  }, [plan]);

  // "Games for you" joins move the goal cap, so the cached preview is stale.
  const planStaleRef = useRef(false);
  const markPlanStale = useCallback(() => {
    planStaleRef.current = true;
  }, []);

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
  const toggleProposal = useCallback(
    (key: string) => {
      selectionHaptic();
      setExcludedProposalKeys(prev => {
        const removing = !prev.includes(key);
        const next = removing ? [...prev, key] : prev.filter(k => k !== key);
        const proposal = plan?.proposals.find(p => p.key === key);
        Analytics.weeklyCheckinPlanProposalToggled({
          action: removing ? 'exclude' : 'restore',
          sport: proposal?.sportName ?? 'unknown',
          match_date: proposal?.matchDate ?? '',
          remaining_included: (plan?.proposals.length ?? 0) - next.length,
        });
        return next;
      });
    },
    [plan]
  );
  const setOptOut = useCallback((b: boolean) => {
    selectionHaptic();
    setOptOutState(b);
    Analytics.weeklyCheckinPlanOptOutToggled({ enabled: b });
  }, []);

  // Validation — step 1 (recap + goal) gates on a valid frequency (defaults are
  // valid). Step 2 (availability) gates on ≥ MIN_AVAILABILITY_CELLS.
  // Steps 3/4 are always submittable (joining and trimming are both optional).
  // Step 5 has no CTA — it's the success state.
  const canAdvance = useMemo(() => {
    switch (currentStep) {
      case 1:
        return frequencyGoal >= 1 && frequencyGoal <= 5;
      case 2:
        return windowCellCount >= MIN_AVAILABILITY_CELLS;
      case 3:
        return true; // match_opportunities — joining is optional, always continue
      case 4:
        return true; // match_plan — every selection (incl. none) is submittable
      case 5:
        return false; // no advance from the success step
      default:
        return false;
    }
  }, [currentStep, windowCellCount, frequencyGoal]);

  // Submit handler — called from the match-plan CTA when that step is enabled,
  // otherwise from goNext when leaving the last visible step. Runs the
  // availability save + RPC, then advances to the All-Set step.
  const submit = useCallback(async () => {
    // The confirmed selection: every proposal the player didn't remove, minus
    // their removed invitees. Opt-out (or no proposals) submits an empty plan —
    // "create nothing" — which is NOT the same as plan:null (legacy autonomous
    // generation), used only when the preview itself failed. With the plan step
    // hidden, the query above never runs, so this is always the empty plan.
    const confirmedProposals: PlanProposalSubmit[] =
      !plan || optOut
        ? []
        : plan.proposals
            .filter(p => !excludedProposalKeys.includes(p.key))
            .map(p => ({
              sport_id: p.sportId,
              match_date: p.matchDate,
              start_hour: p.startHour,
              facility_id: p.facilityId,
              invite_excluded_player_ids: [],
            }));
    const inviteesExcluded = 0;

    try {
      const res = await recordCheckIn({
        frequencyGoal,
        optOut,
        autoInvite: false,
        plan: planError ? null : { proposals: confirmedProposals },
        availability,
        windowDays,
      });
      // The match-plan step (step 4) completes on a successful submit — only a
      // real funnel step while it's actually shown.
      if (PLAN_STEP_ENABLED) {
        Analytics.weeklyCheckinStepCompleted({
          step_name: STEP_NAMES[4],
          step_index: 4,
          proposals_included: confirmedProposals.length,
          proposals_excluded: excludedProposalKeys.length,
          invitees_excluded: inviteesExcluded,
          opted_out: optOut,
          auto_invite: false,
        });
      }
      Analytics.weeklyCheckinSubmitted({
        frequency_goal: frequencyGoal,
        availability_cells: availability.size,
        plan_proposals_included: confirmedProposals.length,
        plan_invitees_excluded: inviteesExcluded,
        opted_out: optOut,
        auto_invite: false,
        matches_created: res.createdMatches.length,
        new_streak: res.newStreak,
        milestone_reached: res.milestoneReached,
        freeze_earned: res.freezeEarned,
      });
      setResult(res);
      successHaptic();
      setCurrentStep(5);
      onComplete?.(res);
    } catch (err) {
      errorHaptic();
      Analytics.weeklyCheckinSubmitFailed({ error: (err as Error)?.message ?? 'unknown' });
      Logger.error('Weekly check-in submit failed', err as Error);
      throw err;
    }
  }, [
    recordCheckIn,
    frequencyGoal,
    plan,
    planError,
    optOut,
    excludedProposalKeys,
    availability,
    windowDays,
    onComplete,
  ]);

  // Navigation
  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
  }, []);
  const goNext = useCallback(() => {
    if (isSubmitting) return;
    // Funnel step_completed for the step being left. Steps 1 (recap_goal),
    // 2 (availability) and 3 (match_opportunities) advance via goNext; the
    // match-plan step (when enabled) completes via submit().
    if (currentStep === 1) {
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[1],
        step_index: 1,
        frequency_goal: frequencyGoal,
      });
      setCurrentStep(2);
    } else if (currentStep === 2) {
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[2],
        step_index: 2,
        availability_cells: availability.size,
      });
      // Skip "Games for you" when nothing fits.
      if (!skipOpportunitiesStep) {
        setCurrentStep(3);
      } else if (PLAN_STEP_ENABLED) {
        setCurrentStep(4);
      } else {
        // Plan step hidden: this was the last visible step — finish here.
        submit().catch(() => {});
      }
    } else if (currentStep === 3) {
      Analytics.weeklyCheckinStepCompleted({
        step_name: STEP_NAMES[3],
        step_index: 3,
        opportunities_count: opportunities.length,
      });
      // A join here changed the committed count, which caps the plan — refetch
      // the preview so the plan step never proposes games past the goal.
      if (planStaleRef.current) {
        planStaleRef.current = false;
        queryClient.invalidateQueries({ queryKey: checkInKeys.plans() });
      }
      if (PLAN_STEP_ENABLED) {
        setCurrentStep(4);
      } else {
        // Plan step hidden: submit lands directly on the All-Set recap.
        submit().catch(() => {});
      }
    } else {
      setCurrentStep(prev => (prev < TOTAL_STEPS ? ((prev + 1) as WizardStep) : prev));
    }
    mediumHaptic();
  }, [
    currentStep,
    availability,
    frequencyGoal,
    skipOpportunitiesStep,
    opportunities.length,
    queryClient,
    isSubmitting,
    submit,
  ]);
  const goBack = useCallback(() => {
    // When the recap step is skipped, availability (step 2) is the floor.
    const minStep = skipRecapStep ? 2 : 1;
    setCurrentStep(prev => {
      if (prev <= minStep) return prev;
      // Mirror the forward skip: jump straight from auto_match back to
      // availability when "Games for you" was skipped.
      if (prev === 4 && skipOpportunitiesStep) return 2;
      return (prev - 1) as WizardStep;
    });
  }, [skipRecapStep, skipOpportunitiesStep]);

  // Auto-advance past "Games for you" when nothing fits — covers the case where
  // the query settles empty only after the user already landed on the step.
  // With the plan step hidden there is nowhere left to advance to, so this
  // submits instead (once — the ref stops a failure from retrying in a loop;
  // the step's CTA remains as the manual retry path).
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (currentStep !== 3 || !skipOpportunitiesStep) return;
    if (PLAN_STEP_ENABLED) {
      setCurrentStep(4);
    } else if (!autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      submit().catch(() => {});
    }
  }, [currentStep, skipOpportunitiesStep, submit]);

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

    plan,
    planLoading,
    planError,
    excludedProposalKeys,
    toggleProposal,
    optOut,
    setOptOut,
    markPlanStale,

    submit,
    isSubmitting,
    result,

    canAdvance,

    windowDays,
    windowCellCount,
    skipRecapStep,

    opportunities,
    opportunitiesLoading,
    skipOpportunitiesStep,

    // Epoch ms when the wizard opened — for analytics duration on completion.
    startedAt: startedAtRef.current,
  };
}
