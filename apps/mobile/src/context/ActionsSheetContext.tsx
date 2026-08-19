/**
 * Actions Sheet Context - Controls the Actions bottom sheet
 *
 * This context provides global control over the Actions bottom sheet,
 * which opens when the center tab button is pressed. The sheet displays
 * different content based on auth state:
 * - Guest: Auth form
 * - Authenticated (not onboarded): Onboarding wizard
 * - Onboarded: Actions wizard (create match, group, etc.)
 *
 * The contentMode state is the single source of truth for what content
 * to display in the sheet, eliminating race conditions.
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { SheetManager } from 'react-native-actions-sheet';
import { useProfile } from '@rallia/shared-hooks';
import { Logger } from '@rallia/shared-services';

import type { TournamentEditData } from '../features/tournaments';
import { EVENT_KINDS, type EventKind } from '../features/events/eventKinds';
import type { MatchCreationSource } from '../services/analytics';

import type { MatchDetailData } from './MatchDetailSheetContext';
import { useAuth } from './AuthContext';

// =============================================================================
// TYPES
// =============================================================================

export type ActionsSheetMode = 'auth' | 'onboarding' | 'actions' | 'loading';

/** Pre-fill for the match creation wizard (e.g. "Play again" after feedback). */
export interface MatchCreationPrefill {
  locationType: 'facility' | 'custom' | 'tbd';
  facilityId?: string;
  locationName?: string;
  locationAddress?: string;
  matchDate: string;
  startTime: string;
  endTime?: string;
  timezone?: string;
  format?: 'singles' | 'doubles';
  playerExpectation?: 'casual' | 'competitive' | 'both';
  duration?: string;
  customDurationMinutes?: number;
}

interface ActionsSheetContextType {
  /** Open the Actions bottom sheet, computing initial mode based on auth state */
  openSheet: () => void;

  /** Open the Actions bottom sheet in edit mode with pre-filled match data */
  openSheetForEdit: (match: MatchDetailData) => void;

  /** Open the Actions bottom sheet in edit mode with pre-filled tournament data */
  openSheetForTournamentEdit: (tournament: TournamentEditData) => void;

  /** Open the Actions bottom sheet directly to match creation (skips actions menu) */
  openSheetForMatchCreation: (source?: MatchCreationSource, prefill?: MatchCreationPrefill) => void;

  /** Attribution source for the pending direct-to-creation open (consumed with the flag) */
  matchCreationSource: MatchCreationSource | null;

  /** Pending pre-fill for the creation wizard (consumed by the wizard) */
  matchCreationPrefill: MatchCreationPrefill | null;

  /** Clear the pending pre-fill after the wizard has consumed it */
  clearMatchCreationPrefill: () => void;

  /**
   * Open the Actions bottom sheet directly to event creation (skips the actions
   * menu). Pass `kinds` to narrow the formats on offer; a single kind skips the
   * format picker too and opens that format's wizard.
   */
  openSheetForEventCreation: (kinds?: EventKind[]) => void;

  /** Open match creation wizard with steps 1–2 pre-filled from a booking (e.g. from facility screen) */
  openSheetForMatchCreationFromBooking: (data: {
    facility: unknown;
    slot: unknown;
    facilityId: string;
    courtId: string;
    courtNumber: number | null;
    price?: number;
  }) => void;

  /** Close the Actions bottom sheet */
  closeSheet: () => void;

  /** Current content mode - single source of truth */
  contentMode: ActionsSheetMode;

  /** Directly set the content mode (used for transitions like auth → onboarding) */
  setContentMode: (mode: ActionsSheetMode) => void;

  /** Refresh the profile data (call after onboarding completes to update state) */
  refreshProfile: () => Promise<void>;

  /** The match being edited (null if creating new match) */
  editMatchData: MatchDetailData | null;

  /** Clear the edit match data (call when closing sheet or completing edit) */
  clearEditMatch: () => void;

  /** Flag to indicate we should open directly to match creation wizard */
  shouldOpenMatchCreation: boolean;

  /** Clear the shouldOpenMatchCreation flag after it's been consumed */
  clearMatchCreationFlag: () => void;

  /**
   * Set when the sheet should open straight into event creation. The array is
   * the formats on offer; `null` means no request is pending.
   */
  pendingEventCreation: EventKind[] | null;

  /** Clear the pending event-creation request after it's been consumed */
  clearEventCreationFlag: () => void;

  /** Open the Actions bottom sheet directly to invite players wizard (contacts tab) */
  openSheetForInvitePlayers: () => void;

  /** Flag to indicate we should open directly to invite players wizard */
  shouldOpenInvitePlayers: boolean;

  /** Clear the shouldOpenInvitePlayers flag after it's been consumed */
  clearInvitePlayersFlag: () => void;

  /** Initial booking data when opening wizard from facility "Create game" (consumed by wizard) */
  initialBookingForWizard: {
    facility: unknown;
    slot: unknown;
    facilityId: string;
    courtId: string;
    courtNumber: number | null;
    price?: number;
  } | null;

  /** Clear initial booking data after wizard has consumed it */
  clearInitialBookingFlag: () => void;
}

// =============================================================================
// CONTEXT
// =============================================================================

const ActionsSheetContext = createContext<ActionsSheetContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface ActionsSheetProviderProps {
  children: ReactNode;
}

export const ActionsSheetProvider: React.FC<ActionsSheetProviderProps> = ({ children }) => {
  const { session } = useAuth();
  const { profile, loading: profileLoading, refetch, error: profileError } = useProfile();

  // Bounded retry counter for profile fetch failures while the sheet is in
  // loading mode; reset on each sheet open.
  const profileRetryRef = useRef(0);

  // Content mode state - single source of truth
  const [contentMode, setContentMode] = useState<ActionsSheetMode>('auth');

  // Edit match state - holds match data when editing
  const [editMatchData, setEditMatchData] = useState<MatchDetailData | null>(null);

  // Flag to open directly to match creation wizard
  const [shouldOpenMatchCreation, setShouldOpenMatchCreation] = useState(false);
  const [matchCreationSource, setMatchCreationSource] = useState<MatchCreationSource | null>(null);
  const [matchCreationPrefill, setMatchCreationPrefill] = useState<MatchCreationPrefill | null>(
    null
  );
  const [pendingEventCreation, setPendingEventCreation] = useState<EventKind[] | null>(null);

  // Flag to open directly to invite players wizard (contacts tab)
  const [shouldOpenInvitePlayers, setShouldOpenInvitePlayers] = useState(false);

  // Initial booking data when opening wizard from facility "Create game" (steps 1–2 pre-filled, step 3 to fill)
  const [initialBookingForWizard, setInitialBookingForWizard] = useState<{
    facility: unknown;
    slot: unknown;
    facilityId: string;
    courtId: string;
    courtNumber: number | null;
    price?: number;
  } | null>(null);

  // Refetch profile when auth state changes. Keyed on the user id (not the
  // session object) so token refreshes don't re-trigger it — and written
  // without an eslint-disable, which made React Compiler skip this component.
  const sessionUserId = session?.user?.id;
  useEffect(() => {
    if (sessionUserId) {
      refetch();
    }
  }, [sessionUserId, refetch]);

  /**
   * Compute the appropriate mode based on current auth/profile state
   */
  const computeInitialMode = useCallback((): ActionsSheetMode => {
    // Fresh open = fresh retry budget for the loading-mode effect below.
    profileRetryRef.current = 0;

    // No session = guest user = show auth
    if (!session?.user) {
      return 'auth';
    }

    // Session exists but profile is still loading = show loading (skeleton)
    // Do not show onboarding until we know the user's onboarding status
    if (profileLoading) {
      return 'loading';
    }

    // Profile fetch errored = status UNKNOWN, not "new user". Stay in loading
    // (the effect below retries); showing onboarding here sent onboarded
    // players back through the signup wizard on a transient failure.
    if (!profile && profileError) {
      return 'loading';
    }

    // Profile loaded but no profile row = new user, show onboarding
    if (!profile) {
      return 'onboarding';
    }

    // Session exists but onboarding not completed = show onboarding
    if (!profile.onboarding_completed) {
      return 'onboarding';
    }

    // Fully onboarded = show actions
    return 'actions';
  }, [session?.user, profile, profileLoading, profileError]);

  // When sheet is in loading mode and profile finishes loading, transition to
  // the correct mode. Onboarding requires a DEFINITIVE "no profile row"
  // (fetch settled without error); an errored fetch is retried, then falls
  // back to actions so a veteran is never funneled into the signup wizard.
  useEffect(() => {
    if (contentMode !== 'loading' || profileLoading) return;

    if (profile) {
      setContentMode(profile.onboarding_completed ? 'actions' : 'onboarding');
      return;
    }

    if (!profileError) {
      setContentMode('onboarding');
      return;
    }

    if (profileRetryRef.current < 2) {
      profileRetryRef.current += 1;
      void refetch();
      return;
    }

    Logger.warn('Profile unavailable after retries, falling back to actions mode');
    setContentMode('actions');
  }, [contentMode, profileLoading, profile, profileError, refetch]);

  /**
   * Open the sheet, computing the appropriate initial mode
   */
  const openSheet = useCallback(() => {
    setEditMatchData(null);
    setInitialBookingForWizard(null);
    setShouldOpenInvitePlayers(false);
    const mode = computeInitialMode();
    setContentMode(mode);
    SheetManager.show('main-actions');
  }, [computeInitialMode]);

  /**
   * Open the dedicated tournament-edit sheet. Unlike match edit (which shares
   * the 'main-actions' sheet), tournament edit has its own lightweight sheet so
   * the present is a single clean animation rather than routing through the
   * heavy actions sheet. The tournament is passed via payload (synchronous with
   * show), so the first presented frame already renders the wizard.
   */
  const openSheetForTournamentEdit = useCallback((tournament: TournamentEditData) => {
    SheetManager.show('tournament-edit', { payload: { tournament } });
  }, []);

  /**
   * Open the sheet in edit mode with pre-filled match data
   */
  const openSheetForEdit = useCallback((match: MatchDetailData) => {
    setEditMatchData(match);
    setShouldOpenMatchCreation(false);
    setShouldOpenInvitePlayers(false);
    setInitialBookingForWizard(null);
    setContentMode('actions'); // Always show actions mode when editing
    SheetManager.show('main-actions');
  }, []);

  /**
   * Open the sheet directly to match creation wizard (skips actions menu)
   */
  const openSheetForMatchCreation = useCallback(
    (source?: MatchCreationSource, prefill?: MatchCreationPrefill) => {
      const mode = computeInitialMode();

      // If user is not authenticated or not onboarded, show the appropriate screen first
      if (mode !== 'actions') {
        setContentMode(mode);
        setShouldOpenMatchCreation(false);
        setMatchCreationSource(null);
        setMatchCreationPrefill(null);
        setInitialBookingForWizard(null);
        SheetManager.show('main-actions');
        return;
      }

      // User is authenticated and onboarded - open directly to match creation
      setEditMatchData(null);
      setInitialBookingForWizard(null);
      setMatchCreationSource(source ?? 'direct');
      setMatchCreationPrefill(prefill ?? null);
      setShouldOpenMatchCreation(true);
      setContentMode('actions');
      SheetManager.show('main-actions');
    },
    [computeInitialMode]
  );

  const clearMatchCreationPrefill = useCallback(() => {
    setMatchCreationPrefill(null);
  }, []);

  /**
   * Open the sheet directly to event creation (skips the actions menu). The
   * sheet still gates it on admin (events are admin-gated during rollout), so
   * callers should only surface this to admins.
   */
  const openSheetForEventCreation = useCallback(
    (kinds?: EventKind[]) => {
      const mode = computeInitialMode();
      if (mode !== 'actions') {
        setContentMode(mode);
        setPendingEventCreation(null);
        SheetManager.show('main-actions');
        return;
      }
      setEditMatchData(null);
      setInitialBookingForWizard(null);
      setShouldOpenMatchCreation(false);
      setPendingEventCreation(kinds ?? EVENT_KINDS.map(d => d.kind));
      setContentMode('actions');
      SheetManager.show('main-actions');
    },
    [computeInitialMode]
  );

  /**
   * Open match creation wizard with steps 1–2 pre-filled from a booking (from facility screen)
   */
  const openSheetForMatchCreationFromBooking = useCallback(
    (data: {
      facility: unknown;
      slot: unknown;
      facilityId: string;
      courtId: string;
      courtNumber: number | null;
    }) => {
      const mode = computeInitialMode();
      if (mode !== 'actions') {
        setContentMode(mode);
        setShouldOpenMatchCreation(false);
        setInitialBookingForWizard(null);
        SheetManager.show('main-actions');
        return;
      }
      setEditMatchData(null);
      setInitialBookingForWizard(data);
      setShouldOpenMatchCreation(true);
      setContentMode('actions');
      SheetManager.show('main-actions');
    },
    [computeInitialMode]
  );

  /**
   * Open the sheet directly to invite players wizard (contacts tab)
   */
  const openSheetForInvitePlayers = useCallback(() => {
    const mode = computeInitialMode();

    // If user is not authenticated or not onboarded, show the appropriate screen first
    if (mode !== 'actions') {
      setContentMode(mode);
      setShouldOpenInvitePlayers(false);
      SheetManager.show('main-actions');
      return;
    }

    // User is authenticated and onboarded - open directly to invite players
    setEditMatchData(null);
    setInitialBookingForWizard(null);
    setShouldOpenMatchCreation(false);
    setShouldOpenInvitePlayers(true);
    setContentMode('actions');
    SheetManager.show('main-actions');
  }, [computeInitialMode]);

  /**
   * Clear the shouldOpenInvitePlayers flag (called by ActionsBottomSheet after consuming it)
   */
  const clearInvitePlayersFlag = useCallback(() => {
    setShouldOpenInvitePlayers(false);
  }, []);

  /**
   * Clear the edit match data
   */
  const clearEditMatch = useCallback(() => {
    setEditMatchData(null);
  }, []);

  /**
   * Clear the shouldOpenMatchCreation flag (called by ActionsBottomSheet after consuming it)
   */
  const clearMatchCreationFlag = useCallback(() => {
    setShouldOpenMatchCreation(false);
    setMatchCreationSource(null);
  }, []);

  const clearEventCreationFlag = useCallback(() => {
    setPendingEventCreation(null);
  }, []);

  /**
   * Clear initial booking data after wizard has consumed it
   */
  const clearInitialBookingFlag = useCallback(() => {
    setInitialBookingForWizard(null);
  }, []);

  /**
   * Close the sheet
   */
  const closeSheet = useCallback(() => {
    SheetManager.hide('main-actions');
    // Clear edit data after a delay to allow dismiss animation
    setTimeout(() => {
      setEditMatchData(null);
    }, 300);
  }, []);

  /**
   * Refresh the profile data (call after onboarding completes)
   */
  const refreshProfile = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Memoized so provider re-renders don't hand every consumer (26+
  // useRequireOnboarding call sites) a new identity on each render.
  const contextValue: ActionsSheetContextType = useMemo(
    () => ({
      openSheet,
      openSheetForEdit,
      openSheetForTournamentEdit,
      openSheetForMatchCreation,
      openSheetForEventCreation,
      openSheetForMatchCreationFromBooking,
      closeSheet,
      contentMode,
      setContentMode,
      refreshProfile,
      editMatchData,
      clearEditMatch,
      shouldOpenMatchCreation,
      matchCreationSource,
      matchCreationPrefill,
      clearMatchCreationPrefill,
      clearMatchCreationFlag,
      pendingEventCreation,
      clearEventCreationFlag,
      openSheetForInvitePlayers,
      shouldOpenInvitePlayers,
      clearInvitePlayersFlag,
      initialBookingForWizard,
      clearInitialBookingFlag,
    }),
    [
      openSheet,
      openSheetForEdit,
      openSheetForTournamentEdit,
      openSheetForMatchCreation,
      openSheetForEventCreation,
      openSheetForMatchCreationFromBooking,
      closeSheet,
      contentMode,
      setContentMode,
      refreshProfile,
      editMatchData,
      clearEditMatch,
      shouldOpenMatchCreation,
      matchCreationSource,
      matchCreationPrefill,
      clearMatchCreationPrefill,
      clearMatchCreationFlag,
      pendingEventCreation,
      clearEventCreationFlag,
      openSheetForInvitePlayers,
      shouldOpenInvitePlayers,
      clearInvitePlayersFlag,
      initialBookingForWizard,
      clearInitialBookingFlag,
    ]
  );

  return (
    <ActionsSheetContext.Provider value={contextValue}>{children}</ActionsSheetContext.Provider>
  );
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access the Actions sheet controls.
 *
 * @example
 * const { openSheet, closeSheet, contentMode, setContentMode } = useActionsSheet();
 *
 * // Open the sheet when center tab is pressed
 * <TouchableOpacity onPress={openSheet}>
 *   <Icon name="add-circle" />
 * </TouchableOpacity>
 *
 * // Transition from auth to onboarding after successful auth
 * const handleAuthSuccess = (needsOnboarding: boolean) => {
 *   if (needsOnboarding) {
 *     setContentMode('onboarding');
 *   } else {
 *     closeSheet();
 *   }
 * };
 */
export const useActionsSheet = (): ActionsSheetContextType => {
  const context = useContext(ActionsSheetContext);

  if (context === undefined) {
    throw new Error('useActionsSheet must be used within an ActionsSheetProvider');
  }

  return context;
};
