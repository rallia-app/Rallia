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

import React, { createContext, useContext, useRef, useCallback, useState, ReactNode } from 'react';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { MatchWithDetails } from '@rallia/shared-types';
import { getMatchWithDetails } from '@rallia/shared-services';

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
  openSheet: (match: MatchDetailData) => void;

  /** Close the Match Detail bottom sheet */
  closeSheet: () => void;

  /** The currently selected match to display */
  selectedMatch: MatchDetailData | null;

  /** Reference to the bottom sheet for direct control if needed */
  sheetRef: React.RefObject<BottomSheetModal | null>;

  /** Update the selected match */
  updateSelectedMatch: (match: MatchDetailData) => void;

  /** Callback for BottomSheetModal onDismiss — clears selectedMatch after animation completes */
  handleSheetDismiss: () => void;
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
  const sheetRef = useRef<BottomSheetModal>(null);
  const [selectedMatch, setSelectedMatch] = useState<MatchDetailData | null>(null);

  /**
   * Open the sheet with the specified match.
   * Uses the passed match as-is so the sheet can show scores immediately when the caller
   * already includes result (e.g. from list queries). Only refetches when the match has no
   * result so we still get scores for lists that don't include the result relation.
   */
  const openSheet = useCallback((match: MatchDetailData) => {
    setSelectedMatch(match);
    sheetRef.current?.present();
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
  }, []);

  /**
   * Close the sheet. Selected match is cleared via handleSheetDismiss
   * which fires after the dismiss animation completes.
   */
  const closeSheet = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  /**
   * Called by BottomSheetModal's onDismiss — clears selectedMatch
   * only after the dismiss animation has fully completed.
   */
  const handleSheetDismiss = useCallback(() => {
    setSelectedMatch(null);
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
    sheetRef,
    updateSelectedMatch,
    handleSheetDismiss,
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
