/**
 * Deep Link Context - Handles pending deep link actions
 *
 * This context stores pending deep link data (e.g., match ID from notification tap)
 * that screens can consume to trigger actions after navigation completes.
 *
 * Flow:
 * 1. Notification is tapped
 * 2. Push notification handler sets pending match ID
 * 3. Navigation occurs to target screen (e.g., PlayerMatches)
 * 4. Screen checks for pending deep link and opens match detail sheet
 * 5. Deep link state is cleared
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// =============================================================================
// TYPES
// =============================================================================

interface PendingMatchDeepLink {
  /** Match ID to open after navigation */
  matchId: string;
  /** Timestamp when the deep link was set (for expiration) */
  timestamp: number;
}

interface DeepLinkContextType {
  /** Set a pending match to open */
  setPendingMatchId: (matchId: string) => void;

  /** Get and clear the pending match ID (returns null if none or expired) */
  consumePendingMatchId: () => string | null;

  /** Check if there's a pending match without consuming it */
  hasPendingMatch: () => boolean;

  /** Clear any pending deep link (e.g., on navigation away) */
  clearPendingDeepLink: () => void;

  /** The current pending match (reactive — triggers re-renders when set) */
  pendingMatchId: string | null;
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
  const [pendingMatch, setPendingMatch] = useState<PendingMatchDeepLink | null>(null);

  /**
   * Set a pending match ID to open after navigation
   */
  const setPendingMatchId = useCallback((matchId: string) => {
    setPendingMatch({
      matchId,
      timestamp: Date.now(),
    });
  }, []);

  /**
   * Check if the pending deep link is still valid (not expired)
   */
  const isDeepLinkValid = useCallback((): boolean => {
    if (!pendingMatch) return false;
    const elapsed = Date.now() - pendingMatch.timestamp;
    return elapsed < DEEP_LINK_EXPIRY_MS;
  }, [pendingMatch]);

  /**
   * Get and clear the pending match ID
   * Returns null if no pending match or if expired
   */
  const consumePendingMatchId = useCallback((): string | null => {
    if (!pendingMatch || !isDeepLinkValid()) {
      setPendingMatch(null);
      return null;
    }

    const matchId = pendingMatch.matchId;
    setPendingMatch(null);
    return matchId;
  }, [pendingMatch, isDeepLinkValid]);

  /**
   * Check if there's a valid pending match without consuming it
   */
  const hasPendingMatch = useCallback((): boolean => {
    return isDeepLinkValid();
  }, [isDeepLinkValid]);

  /**
   * Clear any pending deep link
   */
  const clearPendingDeepLink = useCallback(() => {
    setPendingMatch(null);
  }, []);

  const contextValue: DeepLinkContextType = {
    setPendingMatchId,
    consumePendingMatchId,
    hasPendingMatch,
    clearPendingDeepLink,
    pendingMatchId: pendingMatch?.matchId ?? null,
  };

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
 * // In target screen (PlayerMatches):
 * const { consumePendingMatchId } = useDeepLink();
 * useEffect(() => {
 *   const matchId = consumePendingMatchId();
 *   if (matchId) {
 *     // Fetch match and open detail sheet
 *   }
 * }, []);
 */
export const useDeepLink = (): DeepLinkContextType => {
  const context = useContext(DeepLinkContext);

  if (context === undefined) {
    throw new Error('useDeepLink must be used within a DeepLinkProvider');
  }

  return context;
};
