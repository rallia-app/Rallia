/**
 * Match Detail Sheet Context - Controls the Match Detail bottom sheet
 *
 * This context provides global control over the Match Detail bottom sheet,
 * which opens when a match card is pressed. The sheet displays comprehensive
 * match information and action buttons.
 *
 * When opening, we refetch full match details (including result) so that
 * later visits show the correct state (e.g. registered score) even when
 * the match was opened from a list that doesn't include the result relation.
 */

import React, { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import { SheetManager, getSheetStack } from 'react-native-actions-sheet';
import type { MatchWithDetails } from '@rallia/shared-types';

import type { MatchDeepLinkAction } from '../navigation/deepLinkStore';
import { getMatchWithDetails } from '@rallia/shared-services';

import * as Analytics from '#/services/analytics';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Extended match type that includes distance information from nearby searches
 * and all the additional fields that exist at runtime but aren't in TypeScript types yet.
 *
 * Note: The Supabase types are out of sync with the actual database schema.
 * These fields exist in the database but haven't been regenerated in types.
 */
export interface MatchDetailData extends MatchWithDetails {
  /** Distance in meters from the user's location, returned by the search_matches_nearby RPC */
  distance_meters?: number | null;
  /** Timestamp when the host last edited the match */
  host_edited_at: string | null;
}

interface MatchDetailSheetContextType {
  /** Open the Match Detail bottom sheet with the specified match */
  openSheet: (
    match: MatchDetailData,
    options?: {
      onMatchRemoved?: () => void;
      onDismiss?: () => void;
      source?: string;
      /** Sub-destination to run once the match has loaded (email CTA deep links). */
      autoAction?: MatchDeepLinkAction;
    }
  ) => void;

  /** Close the Match Detail bottom sheet */
  closeSheet: () => void;

  /** The currently selected match to display */
  selectedMatch: MatchDetailData | null;

  /** Update the selected match */
  updateSelectedMatch: (match: MatchDetailData) => void;

  /** Callback for BottomSheetModal onDismiss — clears selectedMatch after animation completes */
  handleSheetDismiss: () => void;

  /** Callback fired when the user leaves or cancels the match from the sheet */
  onMatchRemovedRef: React.RefObject<(() => void) | null>;

  /** Surface the current match was opened from — read by the sheet's join
   *  handlers so match_joined/match_join_requested carry discovery_source. */
  discoverySourceRef: React.RefObject<string>;

  /** Pending sub-destination from a deep link. The sheet consumes it once the
   *  match has loaded, then clears it so a later manual open stays inert. */
  autoActionRef: React.RefObject<MatchDeepLinkAction | null>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const MatchDetailSheetContext = createContext<MatchDetailSheetContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface MatchDetailSheetProviderProps {
  children: ReactNode;
}

export const MatchDetailSheetProvider: React.FC<MatchDetailSheetProviderProps> = ({ children }) => {
  const onMatchRemovedRef = React.useRef<(() => void) | null>(null);
  const onDismissRef = React.useRef<(() => void) | null>(null);
  const discoverySourceRef = React.useRef<string>('match_card');
  const autoActionRef = React.useRef<MatchDeepLinkAction | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<MatchDetailData | null>(null);

  /**
   * Open the sheet with the specified match.
   * Uses the passed match as-is so the sheet can show scores immediately when the caller
   * already includes result (e.g. from list queries). Only refetches when the match has no
   * result so we still get scores for lists that don't include the result relation.
   */
  const openSheet = useCallback(
    (
      match: MatchDetailData,
      options?: {
        onMatchRemoved?: () => void;
        onDismiss?: () => void;
        source?: string;
        autoAction?: MatchDeepLinkAction;
      }
    ) => {
      discoverySourceRef.current = options?.source ?? 'match_card';
      autoActionRef.current = options?.autoAction ?? null;
      Analytics.matchViewed({
        match_id: match.id,
        source: discoverySourceRef.current,
        is_auto_generated: match.is_auto_generated ?? false,
      });
      onMatchRemovedRef.current = options?.onMatchRemoved ?? null;
      onDismissRef.current = options?.onDismiss ?? null;
      setSelectedMatch(match);
      // Opening a match while one is already presented must SWAP the content,
      // never push a second copy of the same sheet. Both copies read this one
      // `selectedMatch`, so closing the top one runs handleSheetDismiss, nulls
      // the shared state, and leaves the copy underneath rendering an empty
      // sheet with no way back.
      if (!getSheetStack().some(sheet => sheet.id === 'match-detail')) {
        SheetManager.show('match-detail');
      }
      const hasResult = Array.isArray(match.result)
        ? (match.result?.length ?? 0) > 0
        : !!match.result;
      if (!hasResult) {
        getMatchWithDetails(match.id).then(refreshed => {
          if (refreshed) {
            setSelectedMatch({
              ...refreshed,
              distance_meters: match.distance_meters,
            } as MatchDetailData);
          }
        });
      }
    },
    []
  );

  /**
   * Close the sheet. Selected match is cleared via handleSheetDismiss
   * which fires after the dismiss animation completes.
   */
  const closeSheet = useCallback(() => {
    SheetManager.hide('match-detail');
  }, []);

  /**
   * Called by BottomSheetModal's onDismiss — clears selectedMatch
   * only after the dismiss animation has fully completed.
   */
  const handleSheetDismiss = useCallback(() => {
    setSelectedMatch(null);
    discoverySourceRef.current = 'match_card';
    autoActionRef.current = null;
    if (onDismissRef.current) {
      onDismissRef.current();
      onDismissRef.current = null;
    }
  }, []);

  /**
   * Update the selected match
   */
  const updateSelectedMatch = useCallback((match: MatchDetailData) => {
    setSelectedMatch(match);
  }, []);

  const contextValue: MatchDetailSheetContextType = {
    openSheet,
    closeSheet,
    selectedMatch,
    updateSelectedMatch,
    handleSheetDismiss,
    onMatchRemovedRef,
    discoverySourceRef,
    autoActionRef,
  };

  return (
    <MatchDetailSheetContext.Provider value={contextValue}>
      {children}
    </MatchDetailSheetContext.Provider>
  );
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access the Match Detail sheet controls.
 *
 * @example
 * const { openSheet, closeSheet, selectedMatch } = useMatchDetailSheet();
 *
 * // Open the sheet when a match card is pressed
 * <MatchCard
 *   match={match}
 *   onPress={() => openSheet(match)}
 * />
 */
export const useMatchDetailSheet = (): MatchDetailSheetContextType => {
  const context = useContext(MatchDetailSheetContext);

  if (context === undefined) {
    throw new Error('useMatchDetailSheet must be used within a MatchDetailSheetProvider');
  }

  return context;
};
