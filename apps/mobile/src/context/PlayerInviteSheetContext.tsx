/**
 * Player Invite Sheet Context - Controls the Player Invite bottom sheet
 *
 * This context provides global control over the Player Invite bottom sheet,
 * which opens when the match host wants to invite players to their match.
 * It wraps the PlayerInviteStep component in a modal presentation.
 */

import React, { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import { SheetManager } from 'react-native-actions-sheet';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Data needed to open the player invite sheet
 */
export interface PlayerInviteData {
  /** Match ID to invite players to */
  matchId: string;
  /** Sport ID to filter players by */
  sportId: string;
  /** Current user ID (host) */
  hostId: string;
  /** Player IDs to exclude from search (existing participants) */
  excludePlayerIds: string[];
}

interface PlayerInviteSheetContextType {
  /** Open the Player Invite bottom sheet with the specified data */
  openSheet: (matchId: string, sportId: string, hostId: string, excludePlayerIds: string[]) => void;

  /** Close the Player Invite bottom sheet */
  closeSheet: () => void;

  /** The current invite data (null when sheet is closed) */
  inviteData: PlayerInviteData | null;
}

// =============================================================================
// CONTEXT
// =============================================================================

const PlayerInviteSheetContext = createContext<PlayerInviteSheetContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface PlayerInviteSheetProviderProps {
  children: ReactNode;
}

export const PlayerInviteSheetProvider: React.FC<PlayerInviteSheetProviderProps> = ({
  children,
}) => {
  const [inviteData, setInviteData] = useState<PlayerInviteData | null>(null);

  /**
   * Open the sheet with the specified invite data
   */
  const openSheet = useCallback(
    (matchId: string, sportId: string, hostId: string, excludePlayerIds: string[]) => {
      const data = { matchId, sportId, hostId, excludePlayerIds };
      setInviteData(data);
      SheetManager.show('player-invite', { payload: data });
    },
    []
  );

  /**
   * Close the sheet and clear the invite data
   */
  const closeSheet = useCallback(() => {
    SheetManager.hide('player-invite');
    // Clear invite data after a delay to allow dismiss animation
    setTimeout(() => {
      setInviteData(null);
    }, 300);
  }, []);

  const contextValue: PlayerInviteSheetContextType = {
    openSheet,
    closeSheet,
    inviteData,
  };

  return (
    <PlayerInviteSheetContext.Provider value={contextValue}>
      {children}
    </PlayerInviteSheetContext.Provider>
  );
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access the Player Invite sheet controls.
 *
 * @example
 * const { openSheet, closeSheet, inviteData } = usePlayerInviteSheet();
 *
 * // Open the sheet from MatchDetailSheet
 * const handleInvite = () => {
 *   openSheet(match.id, match.sport_id, playerId, existingParticipantIds);
 * };
 */
export const usePlayerInviteSheet = (): PlayerInviteSheetContextType => {
  const context = useContext(PlayerInviteSheetContext);

  if (context === undefined) {
    throw new Error('usePlayerInviteSheet must be used within a PlayerInviteSheetProvider');
  }

  return context;
};
