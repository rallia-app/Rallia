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
  MAX_PLAN_INVITEES_SHOWN,
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

// Auto-open throttle, written every time the wizard mounts (any entry point) and
// read only by WeeklyCheckInAutoOpener. Deliberately separate from the cooldown
// key above: this one never suppresses the home banner, so the player can still
// open the wizard as often as they want.
export const WEEKLY_CHECKIN_AUTO_OPEN_AT_KEY = '@rallia/weekly-checkin-auto-open-at';

// The rolling check-in only edits a 4-day window, so the floor is lower than
// onboarding's 6/week — a few slots across the window is enough for the
// match-creation logic to have something to work with.
export const MIN_AVAILABILITY_CELLS = 3;

// Match-plan step (step 4): one proposal at a time — the player skips a
// suggested game or confirms it after trimming its invite list. Flipping this
// off reverts to submitting an empty plan (create nothing) straight from
// "Games for you" — or from availability when that step is skipped.
export const PLAN_STEP_ENABLED: boolean = true;

export type WizardStep = 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS: WizardStep = 5;

/** The player's verdict on one proposed game (the plan step's deck). */
export type PlanDecision = 'create' | 'skip';
/** One decided card, in decision order (order enables undo via back). */
export interface PlanDecisionEntry {
  key: string;
  decision: PlanDecision;
}

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
  /** Deck verdicts so far, in decision order (undo pops the last one). */
  planDecisions: PlanDecisionEntry[];
  /** Records the verdict on one card (replaces any prior verdict for it). */
  decideProposal: (key: string, decision: PlanDecision) => void;
  /** Pops the most recent verdict. Returns false when there was none. */
  undoLastPlanDecision: () => boolean;
  /** Selected invitee ids per proposal key (seeded to the top candidates). */
  inviteSelections: Record<string, string[]>;
  toggleInvitee: (proposalKey: string, playerId: string) => void;
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
   * The objective is still fresh (set within the last 3 months), so the
   * recap+goal step is skipped entirely — the wizard opens on availability and
   * back stops there. Drives the header's step numbering (3 dots instead of 4).
   */
  skipRecapStep: boolean;
  /**
   * Availability was refreshed recently (coverage still covers the window), so
   * the availability step is skipped — a sport-switch check-in goes straight to
   * the goal or the games/plan steps. Drives navigation + the header dot count.
   */
  skipAvailabilityStep: boolean;
  /** First non-skipped step — the wizard's landing step and back floor. */
  firstStep: WizardStep;

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
  /**
   * The wizard's sport scope — the app's selected sport mode. Opportunities,
   * plan proposals, the weekly goal and the streak are all scoped to this
   * sport; null (context still loading) falls back server-side to the primary
   * sport for goal/streak and to all active sports for match content. Only
   * availability stays player-wide.
   */
  sportId?: string | null;
}

export function useWeeklyCheckInWizard(
  options: UseWeeklyCheckInWizardOptions = {}
): UseWeeklyCheckInWizard {
  const { onComplete, sportId = null } = options;

  // Step navigation
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // Load cold-start data
  const {
    data: context = null,
    isLoading: isContextLoading,
    error: contextError,
  } = useCheckInContext({ sportId });
  const { data: initialKeys, isLoading: availabilityLoading } = useAvailabilityKeys();

  // Form state — seeded from loaded data once available
  const [availability, setAvailability] = useState<HourGrid>(() => new Set());
  const [frequencyGoal, setFrequencyGoalState] = useState<number>(3);

  // Plan deck — the player reviews proposals ONE AT A TIME: each card is either
  // confirmed ('create') or skipped, and the verdicts accumulate here in order
  // so back can undo the latest one. Invitee selections are per-proposal and
  // seeded to the top candidates when the preview lands.
  // Arrays/records (not Sets): Hermes iterator quirk + React state ergonomics.
  const [planDecisions, setPlanDecisions] = useState<PlanDecisionEntry[]>([]);
  const [inviteSelections, setInviteSelections] = useState<Record<string, string[]>>({});
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
  // The playing objective is asked once per quarter (fresh ⇔ (re)declared within
  // the last 3 months). While it's fresh the whole recap+goal step is skipped —
  // a re-opened wizard (rolling availability coverage ran out mid-week) goes
  // straight to the availability step instead of replaying a recap with nothing
  // to decide.
  const skipRecapStep = !!context?.frequencyAlreadySetThisWeek;
  // Availability was refreshed recently (coverage still covers the window), so
  // there's nothing to re-declare — skip the availability step. Drives the
  // sport-switch flow: with the goal unset but the schedule fresh, the wizard
  // opens straight on the goal step. Only ever true once context has loaded.
  const skipAvailabilityStep = !!context && !context.availabilityRefreshNeeded;

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
    sportId,
    timezone: context?.timezone,
    enabled: currentStep >= 2 && currentStep <= 3,
  });
  const opportunitiesLoading = opportunitiesIsLoading && opportunitySlots.length > 0;
  // Settled with nothing that fits → skip the step. Only true once the query has
  // actually run for the current slots (isFetched guards the not-yet-run state).
  const skipOpportunitiesStep = opportunitiesFetched && opportunities.length === 0;

  // Step visibility given the three skip conditions. Steps: 1 recap+goal,
  // 2 availability, 3 opportunities, 4 plan, 5 all-set. The wizard only lands on
  // and navigates between visible steps — a single source of truth so goNext,
  // goBack, the landing step and the header dots all agree.
  const isStepVisible = useCallback(
    (step: WizardStep): boolean => {
      switch (step) {
        case 1:
          return !skipRecapStep;
        case 2:
          return !skipAvailabilityStep;
        case 3:
          return !skipOpportunitiesStep;
        case 4:
          return PLAN_STEP_ENABLED;
        case 5:
          return true;
        default:
          return false;
      }
    },
    [skipRecapStep, skipAvailabilityStep, skipOpportunitiesStep]
  );
  // Landing step + back floor: the first non-skipped step. skipOpportunities
  // resolves async, so when both recap and availability are skipped the worst
  // case lands on step 3 and the autoSubmit effect bounces to the plan step.
  const firstStep: WizardStep = !skipRecapStep ? 1 : !skipAvailabilityStep ? 2 : 3;

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
    sportId,
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

  // Seed each proposal's invite selection to its top candidates. Runs on every
  // plan change (a "Games for you" join invalidates + refetches the preview)
  // but only fills keys the player hasn't touched yet, so their edits survive.
  useEffect(() => {
    if (!plan) return;
    setInviteSelections(prev => {
      let changed = false;
      const next = { ...prev };
      for (const p of plan.proposals) {
        if (!(p.key in next)) {
          next[p.key] = p.invitees.slice(0, MAX_PLAN_INVITEES_SHOWN).map(i => i.playerId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [plan]);

  // "Games for you" joins move the goal cap, so the cached preview is stale.
  const planStaleRef = useRef(false);
  const markPlanStale = useCallback(() => {
    planStaleRef.current = true;
  }, []);

  // Jump to the first non-skipped step once the context lands (only if the user
  // is still sitting on step 1, which they are — step 1 shows a loader until
  // context). Covers recap-skip (goal already set) and availability-skip
  // (schedule refreshed recently) together.
  const skipDecidedRef = useRef(false);
  useEffect(() => {
    if (skipDecidedRef.current || !context) return;
    skipDecidedRef.current = true;
    if (firstStep !== 1) {
      setCurrentStep(prev => (prev === 1 ? firstStep : prev));
    }
  }, [context, firstStep]);

  // Submission
  const { mutateAsync: recordCheckIn, isPending: isSubmitting } = useRecordCheckIn();
  const [result, setResult] = useState<CheckInResult | null>(null);

  // Setters with light haptics on user interaction.
  const setFrequencyGoal = useCallback((n: number) => {
    selectionHaptic();
    setFrequencyGoalState(Math.max(1, Math.min(5, n)));
  }, []);
  const decideProposal = useCallback(
    (key: string, decision: PlanDecision) => {
      setPlanDecisions(prev => [...prev.filter(d => d.key !== key), { key, decision }]);
      // Only skips fire the toggle event — confirmed cards are counted by the
      // submitted event's proposals_included.
      if (decision === 'skip') {
        const proposal = plan?.proposals.find(p => p.key === key);
        const skipped =
          planDecisions.filter(d => d.decision === 'skip' && d.key !== key).length + 1;
        Analytics.weeklyCheckinPlanProposalToggled({
          action: 'exclude',
          sport: proposal?.sportName ?? 'unknown',
          match_date: proposal?.matchDate ?? '',
          remaining_included: (plan?.proposals.length ?? 0) - skipped,
        });
      }
    },
    [plan, planDecisions]
  );

  const undoLastPlanDecision = useCallback((): boolean => {
    if (isSubmitting) return false;
    const last = planDecisions[planDecisions.length - 1];
    if (!last) return false;
    setPlanDecisions(prev => prev.slice(0, -1));
    if (last.decision === 'skip') {
      const proposal = plan?.proposals.find(p => p.key === last.key);
      const skipped = planDecisions.filter(d => d.decision === 'skip').length - 1;
      Analytics.weeklyCheckinPlanProposalToggled({
        action: 'restore',
        sport: proposal?.sportName ?? 'unknown',
        match_date: proposal?.matchDate ?? '',
        remaining_included: (plan?.proposals.length ?? 0) - skipped,
      });
    }
    return true;
  }, [plan, planDecisions, isSubmitting]);

  const toggleInvitee = useCallback(
    (proposalKey: string, playerId: string) => {
      selectionHaptic();
      const proposal = plan?.proposals.find(p => p.key === proposalKey);
      setInviteSelections(prev => {
        const current = prev[proposalKey] ?? [];
        const removing = current.includes(playerId);
        Analytics.weeklyCheckinPlanInviteeToggled({
          action: removing ? 'exclude' : 'restore',
          sport: proposal?.sportName ?? 'unknown',
        });
        return {
          ...prev,
          [proposalKey]: removing ? current.filter(id => id !== playerId) : [...current, playerId],
        };
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
    // The confirmed selection: every proposal the player approved on the deck,
    // minus their unselected invitees. Undecided or skipped cards are dropped.
    // Opt-out (or no proposals) submits an empty plan — "create nothing" —
    // which is NOT the same as plan:null (legacy autonomous generation), used
    // only when the preview itself failed.
    const confirmed =
      !plan || optOut
        ? []
        : plan.proposals.filter(
            p => planDecisions.find(d => d.key === p.key)?.decision === 'create'
          );
    const confirmedProposals: PlanProposalSubmit[] = confirmed.map(p => {
      const selected = inviteSelections[p.key] ?? [];
      return {
        sport_id: p.sportId,
        match_date: p.matchDate,
        start_hour: p.startHour,
        facility_id: p.facilityId,
        // Exclusion list = the full previewed candidate pool minus the kept
        // players. The invite pass draws from that same ranked pool (same cap),
        // so this makes exactly the selected players receive an invite.
        invite_excluded_player_ids: p.invitees
          .filter(i => !selected.includes(i.playerId))
          .map(i => i.playerId),
      };
    });
    const inviteesExcluded = confirmedProposals.reduce(
      (sum, p) => sum + p.invite_excluded_player_ids.length,
      0
    );
    const inviteesSelected = confirmed.reduce((sum, p) => {
      const selected = inviteSelections[p.key] ?? [];
      return sum + p.invitees.filter(i => selected.includes(i.playerId)).length;
    }, 0);
    const skippedCount = plan
      ? plan.proposals.filter(p => planDecisions.find(d => d.key === p.key)?.decision === 'skip')
          .length
      : 0;
    // The invite dispatch is gated on the persisted auto_invite preference, so
    // it must be ON whenever the player kept at least one invitee.
    const autoInvite = inviteesSelected > 0;

    try {
      const res = await recordCheckIn({
        frequencyGoal,
        // The objective was actually (re)declared this session iff the recap+goal
        // step was shown. When skipped, the goal is inherited — carried forward
        // without re-arming the 3-month gate.
        goalIsExplicit: !skipRecapStep,
        sportId,
        optOut,
        autoInvite,
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
          proposals_excluded: skippedCount,
          invitees_excluded: inviteesExcluded,
          opted_out: optOut,
          auto_invite: autoInvite,
        });
      }
      Analytics.weeklyCheckinSubmitted({
        frequency_goal: frequencyGoal,
        availability_cells: availability.size,
        plan_proposals_included: confirmedProposals.length,
        plan_invitees_excluded: inviteesExcluded,
        opted_out: optOut,
        auto_invite: autoInvite,
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
    skipRecapStep,
    sportId,
    plan,
    planError,
    optOut,
    planDecisions,
    inviteSelections,
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
    // Funnel step_completed for the step being LEFT (only steps actually shown
    // reach goNext — a skipped step never fires its event). The match-plan step
    // (when enabled) completes via submit(), not goNext.
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
    }

    if (currentStep >= 1 && currentStep <= 3) {
      // Advance to the next visible pre-submit step (2..4, skipping any hidden
      // ones). If none remains, the step just left was the last one shown, so
      // this completes the wizard.
      let target: WizardStep | null = null;
      for (let s = (currentStep + 1) as WizardStep; s <= 4; s = (s + 1) as WizardStep) {
        if (isStepVisible(s)) {
          target = s;
          break;
        }
      }
      if (target !== null) {
        setCurrentStep(target);
      } else {
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
    opportunities.length,
    queryClient,
    isSubmitting,
    submit,
    isStepVisible,
  ]);
  const goBack = useCallback(() => {
    // On the plan deck, back first rewinds the previous card; it only leaves
    // the step once there's nothing left to undo. Frozen entirely while the
    // submit is in flight — leaving mid-submit would race the jump to All-Set.
    if (currentStep === 4 && isSubmitting) return;
    if (currentStep === 4 && undoLastPlanDecision()) return;
    // Step to the nearest visible step below the current one, skipping any
    // hidden steps (recap / availability / opportunities). Stops at the floor.
    setCurrentStep(prev => {
      for (let s = (prev - 1) as WizardStep; s >= 1; s = (s - 1) as WizardStep) {
        if (isStepVisible(s)) return s;
      }
      return prev;
    });
  }, [currentStep, isSubmitting, undoLastPlanDecision, isStepVisible]);

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
    planDecisions,
    decideProposal,
    undoLastPlanDecision,
    inviteSelections,
    toggleInvitee,
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
    skipAvailabilityStep,
    firstStep,

    opportunities,
    opportunitiesLoading,
    skipOpportunitiesStep,

    // Epoch ms when the wizard opened — for analytics duration on completion.
    startedAt: startedAtRef.current,
  };
}
