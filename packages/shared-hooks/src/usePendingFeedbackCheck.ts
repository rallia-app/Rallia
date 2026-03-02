/**
 * usePendingFeedbackCheck Hook
 *
 * Checks for matches that need feedback from the current user on app launch.
 * Returns the most recently ended match within the 48h feedback window
 * where the user hasn't completed feedback.
 */

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMatchNeedingFeedback } from '@rallia/shared-services';
import type { OpponentForFeedback, MatchWithDetails } from '@rallia/shared-types';
import type { PendingFeedbackMatch } from '@rallia/shared-services';

/**
 * Data returned when a match needing feedback is found
 */
export interface PendingFeedbackData {
  matchId: string;
  reviewerId: string;
  participantId: string;
  opponents: OpponentForFeedback[];
  match: MatchWithDetails;
}

/**
 * Options for the usePendingFeedbackCheck hook
 */
export interface UsePendingFeedbackCheckOptions {
  /** User ID to check for pending feedback */
  userId: string | undefined;
  /** Whether the check should run (e.g., after splash completes) */
  enabled: boolean;
  /** Callback when a match needing feedback is found */
  onMatchFound?: (data: PendingFeedbackData) => void;
}

/**
 * Query key for pending feedback check
 */
export const pendingFeedbackKeys = {
  check: (userId: string) => ['pendingFeedback', 'check', userId] as const,
};

/**
 * Hook that checks for matches needing feedback on app launch.
 *
 * This hook:
 * 1. Fetches the most recently ended match needing feedback
 * 2. Prepares the opponent data for the FeedbackSheet
 * 3. Calls onMatchFound callback once when a match is found
 *
 * The check only runs once per hook mount to avoid interrupting the user.
 *
 * @example
 * ```tsx
 * const { isChecking, pendingMatch } = usePendingFeedbackCheck({
 *   userId: user?.id,
 *   enabled: isSplashComplete && isSportSelectionComplete,
 *   onMatchFound: (data) => {
 *     openFeedbackSheet(data.matchId, data.reviewerId, data.participantId, data.opponents);
 *   },
 * });
 * ```
 */
export function usePendingFeedbackCheck(options: UsePendingFeedbackCheckOptions) {
  const { userId, enabled, onMatchFound } = options;

  // Track if we've already triggered the callback
  const hasTriggeredRef = useRef(false);

  // Query for pending feedback match
  const query = useQuery<PendingFeedbackMatch | null>({
    queryKey: pendingFeedbackKeys.check(userId!),
    queryFn: () => getMatchNeedingFeedback(userId!),
    enabled: enabled && !!userId,
    staleTime: Infinity, // Only fetch once per app launch
    gcTime: 0, // Don't cache - we want fresh data on each app launch
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  // Process the result and call callback
  useEffect(() => {
    // Don't process if already triggered, still loading, or no data
    if (hasTriggeredRef.current || query.isLoading || !query.data) {
      return;
    }

    const { match, userParticipant } = query.data;

    // Prepare opponents list (all joined participants except current user)
    const opponents: OpponentForFeedback[] = [];

    if (match.participants) {
      for (const participant of match.participants) {
        // Skip the current user
        if (participant.player_id === userId) {
          continue;
        }

        // Only include joined participants
        if (participant.status !== 'joined') {
          continue;
        }

        const player = Array.isArray(participant.player)
          ? participant.player[0]
          : participant.player;

        if (!player) {
          continue;
        }

        const profile = player.profile;
        const displayName = profile?.display_name || profile?.first_name || 'Player';
        const fullName = profile
          ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
          : 'Player';

        opponents.push({
          participantId: participant.id,
          playerId: participant.player_id,
          name: displayName,
          fullName: fullName || displayName,
          avatarUrl: profile?.profile_picture_url,
          hasExistingFeedback: false, // We'll let the FeedbackSheet wizard check this
          hasExistingReport: false,
        });
      }
    }

    // Only trigger if we have opponents
    if (opponents.length > 0) {
      hasTriggeredRef.current = true;

      const data: PendingFeedbackData = {
        matchId: match.id,
        reviewerId: userId!,
        participantId: userParticipant.id,
        opponents,
        match,
      };

      onMatchFound?.(data);
    }
  }, [query.isLoading, query.data, userId, onMatchFound]);

  return {
    /** Whether the check is in progress */
    isChecking: query.isLoading,

    /** The pending feedback match data (if any) */
    pendingMatch: query.data,

    /** Whether the query has finished (success or error) */
    isComplete: query.isSuccess || query.isError,

    /** Any error that occurred during the check */
    error: query.error,
  };
}

export default usePendingFeedbackCheck;
