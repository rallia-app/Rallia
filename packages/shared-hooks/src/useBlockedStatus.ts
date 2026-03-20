/**
 * useBlockedStatus Hook
 *
 * Manages the blocked status between two users.
 * Used in both PlayerProfile and Chat screens.
 */

import { useCallback } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@rallia/shared-services';

interface UseBlockedStatusResult {
  /** Whether the current user has blocked the other user */
  isBlocked: boolean;
  /** Loading state for the initial check */
  isLoading: boolean;
  /** Whether a block/unblock operation is in progress */
  isToggling: boolean;
  /** Toggle block status - blocks or unblocks based on current status */
  toggleBlock: () => Promise<void>;
  /** Explicitly block the user */
  blockUser: () => Promise<void>;
  /** Explicitly unblock the user */
  unblockUser: () => Promise<void>;
  /** Refetch the blocked status */
  refetch: () => void;
}

/**
 * Hook to check and manage blocked status between the current user and another user
 *
 * @param currentUserId - The current authenticated user's ID
 * @param otherUserId - The other user's ID to check block status for
 * @returns Object containing block status and mutation functions
 *
 * @example
 * ```tsx
 * const { isBlocked, toggleBlock, isToggling } = useBlockedStatus(myUserId, otherUserId);
 *
 * <Button onPress={toggleBlock} disabled={isToggling}>
 *   {isBlocked ? 'Unblock' : 'Block'}
 * </Button>
 * ```
 */
export const useBlockedStatus = (
  currentUserId: string | undefined,
  otherUserId: string | undefined
): UseBlockedStatusResult => {
  const queryClient = useQueryClient();
  const queryKey = ['blockedStatus', currentUserId, otherUserId];

  // Query to check if current user has blocked the other user
  const {
    data: isBlocked = false,
    isLoading,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!currentUserId || !otherUserId) return false;

      const { data, error } = await supabase
        .from('player_block')
        .select('id')
        .eq('player_id', currentUserId)
        .eq('blocked_player_id', otherUserId)
        .maybeSingle();

      if (error) {
        console.error('Error checking blocked status:', error);
        return false;
      }

      return !!data;
    },
    enabled: !!currentUserId && !!otherUserId,
    staleTime: 30000, // 30 seconds
  });

  // Mutation to block a user
  const blockMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId || !otherUserId) {
        throw new Error('Missing user IDs');
      }

      const { error } = await supabase.from('player_block').insert({
        player_id: currentUserId,
        blocked_player_id: otherUserId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKey, true);
      // Also invalidate any related queries
      queryClient.invalidateQueries({ queryKey: ['conversation'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  // Mutation to unblock a user
  const unblockMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId || !otherUserId) {
        throw new Error('Missing user IDs');
      }

      const { error } = await supabase
        .from('player_block')
        .delete()
        .eq('player_id', currentUserId)
        .eq('blocked_player_id', otherUserId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKey, false);
      // Also invalidate any related queries
      queryClient.invalidateQueries({ queryKey: ['conversation'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  const toggleBlock = useCallback(async () => {
    if (isBlocked) {
      await unblockMutation.mutateAsync();
    } else {
      await blockMutation.mutateAsync();
    }
  }, [isBlocked, blockMutation, unblockMutation]);

  const blockUser = useCallback(async () => {
    if (!isBlocked) {
      await blockMutation.mutateAsync();
    }
  }, [isBlocked, blockMutation]);

  const unblockUser = useCallback(async () => {
    if (isBlocked) {
      await unblockMutation.mutateAsync();
    }
  }, [isBlocked, unblockMutation]);

  return {
    isBlocked,
    isLoading,
    isToggling: blockMutation.isPending || unblockMutation.isPending,
    toggleBlock,
    blockUser,
    unblockUser,
    refetch,
  };
};

/**
 * Check if a user is blocked by another user
 * This is used server-side/in queries to filter messages
 * The blocked user should NOT be informed they are blocked
 */
export const checkIfBlockedBy = async (
  currentUserId: string,
  otherUserId: string
): Promise<boolean> => {
  const { data, error } = await supabase
    .from('player_block')
    .select('id')
    .eq('player_id', otherUserId)
    .eq('blocked_player_id', currentUserId)
    .maybeSingle();

  if (error) {
    console.error('Error checking if blocked by:', error);
    return false;
  }

  return !!data;
};

/**
 * Hook to fetch all blocked user IDs for the current user
 * Useful for displaying "You blocked this user" in conversation lists
 */
export const useBlockedUserIds = (currentUserId: string | undefined) => {
  return useQuery({
    queryKey: ['blockedUserIds', currentUserId],
    queryFn: async () => {
      if (!currentUserId) return new Set<string>();

      const { data, error } = await supabase
        .from('player_block')
        .select('blocked_player_id')
        .eq('player_id', currentUserId);

      if (error) {
        console.error('Error fetching blocked user IDs:', error);
        return new Set<string>();
      }

      return new Set(data?.map(row => row.blocked_player_id) || []);
    },
    enabled: !!currentUserId,
    staleTime: 30000, // 30 seconds
  });
};
