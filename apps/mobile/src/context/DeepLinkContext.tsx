/**
 * Deep Link Context - Handles pending deep link actions
 *
 * This context stores pending deep link data (e.g., match ID from notification tap,
 * group/community invite codes from deep links) that screens can consume to trigger
 * actions after navigation completes.
 *
 * Flow:
 * 1. Deep link is received (notification tap, universal link, etc.)
 * 2. Handler sets pending state (match ID, group invite code, etc.)
 * 3. Navigation occurs to target screen (e.g., Home)
 * 4. Screen checks for pending deep link and performs the action
 * 5. Deep link state is cleared
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

// =============================================================================
// TYPES
// =============================================================================

interface PendingDeepLink<T> {
  /** The deep link payload */
  value: T;
  /** Timestamp when the deep link was set (for expiration) */
  timestamp: number;
}

interface DeepLinkContextType {
  // --- Match ---
  /** Set a pending match to open */
  setPendingMatchId: (matchId: string) => void;
  /** Get and clear the pending match ID (returns null if none or expired) */
  consumePendingMatchId: () => string | null;
  /** Check if there's a pending match without consuming it */
  hasPendingMatch: () => boolean;
  /** The current pending match (reactive) */
  pendingMatchId: string | null;

  // --- Group ---
  /** Set a pending group invite code to join */
  setPendingGroupInviteCode: (inviteCode: string) => void;
  /** Get and clear the pending group invite code (returns null if none or expired) */
  consumePendingGroupInviteCode: () => string | null;

  // --- Community ---
  /** Set a pending community invite code to request joining */
  setPendingCommunityInviteCode: (inviteCode: string) => void;
  /** Get and clear the pending community invite code (returns null if none or expired) */
  consumePendingCommunityInviteCode: () => string | null;

  // --- General ---
  /** Clear all pending deep links */
  clearPendingDeepLink: () => void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Deep links expire after 30 seconds to prevent stale navigation */
const DEEP_LINK_EXPIRY_MS = 30 * 1000;

// =============================================================================
// CONTEXT
// =============================================================================

const DeepLinkContext = createContext<DeepLinkContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface DeepLinkProviderProps {
  children: ReactNode;
}

export const DeepLinkProvider: React.FC<DeepLinkProviderProps> = ({ children }) => {
  const [pendingMatch, setPendingMatch] = useState<PendingDeepLink<string> | null>(null);
  const [pendingGroupInvite, setPendingGroupInvite] = useState<PendingDeepLink<string> | null>(
    null
  );
  const [pendingCommunityInvite, setPendingCommunityInvite] =
    useState<PendingDeepLink<string> | null>(null);

  /**
   * Check if a pending deep link is still valid (not expired)
   */
  const isValid = useCallback((pending: PendingDeepLink<string> | null): boolean => {
    if (!pending) return false;
    return Date.now() - pending.timestamp < DEEP_LINK_EXPIRY_MS;
  }, []);

  /**
   * Generic consume: return the value and clear state, or null if expired/missing
   */
  const consume = useCallback(
    <T,>(
      pending: PendingDeepLink<T> | null,
      setter: React.Dispatch<React.SetStateAction<PendingDeepLink<T> | null>>
    ): T | null => {
      if (!pending || !isValid(pending as PendingDeepLink<string>)) {
        setter(null);
        return null;
      }
      const value = pending.value;
      setter(null);
      return value;
    },
    [isValid]
  );

  // --- Match ---

  const setPendingMatchId = useCallback((matchId: string) => {
    setPendingMatch({ value: matchId, timestamp: Date.now() });
  }, []);

  const consumePendingMatchId = useCallback(
    (): string | null => consume(pendingMatch, setPendingMatch),
    [pendingMatch, consume]
  );

  const hasPendingMatch = useCallback(
    (): boolean => isValid(pendingMatch),
    [pendingMatch, isValid]
  );

  // --- Group ---

  const setPendingGroupInviteCode = useCallback((inviteCode: string) => {
    setPendingGroupInvite({ value: inviteCode, timestamp: Date.now() });
  }, []);

  const consumePendingGroupInviteCode = useCallback(
    (): string | null => consume(pendingGroupInvite, setPendingGroupInvite),
    [pendingGroupInvite, consume]
  );

  // --- Community ---

  const setPendingCommunityInviteCode = useCallback((inviteCode: string) => {
    setPendingCommunityInvite({ value: inviteCode, timestamp: Date.now() });
  }, []);

  const consumePendingCommunityInviteCode = useCallback(
    (): string | null => consume(pendingCommunityInvite, setPendingCommunityInvite),
    [pendingCommunityInvite, consume]
  );

  // --- General ---

  const clearPendingDeepLink = useCallback(() => {
    setPendingMatch(null);
    setPendingGroupInvite(null);
    setPendingCommunityInvite(null);
  }, []);

  const contextValue: DeepLinkContextType = useMemo(
    () => ({
      setPendingMatchId,
      consumePendingMatchId,
      hasPendingMatch,
      pendingMatchId: pendingMatch?.value ?? null,
      setPendingGroupInviteCode,
      consumePendingGroupInviteCode,
      setPendingCommunityInviteCode,
      consumePendingCommunityInviteCode,
      clearPendingDeepLink,
    }),
    [
      setPendingMatchId,
      consumePendingMatchId,
      hasPendingMatch,
      pendingMatch,
      setPendingGroupInviteCode,
      consumePendingGroupInviteCode,
      setPendingCommunityInviteCode,
      consumePendingCommunityInviteCode,
      clearPendingDeepLink,
    ]
  );

  return <DeepLinkContext.Provider value={contextValue}>{children}</DeepLinkContext.Provider>;
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access deep link handling functions.
 *
 * @example
 * // In notification handler:
 * const { setPendingMatchId } = useDeepLink();
 * setPendingMatchId(notification.data.matchId);
 *
 * // In target screen (Home):
 * const { consumePendingMatchId, consumePendingGroupInviteCode } = useDeepLink();
 * useEffect(() => {
 *   const matchId = consumePendingMatchId();
 *   if (matchId) { // Fetch match and open detail sheet }
 *
 *   const groupCode = consumePendingGroupInviteCode();
 *   if (groupCode) { // Join group by invite code }
 * }, []);
 */
export const useDeepLink = (): DeepLinkContextType => {
  const context = useContext(DeepLinkContext);

  if (context === undefined) {
    throw new Error('useDeepLink must be used within a DeepLinkProvider');
  }

  return context;
};
