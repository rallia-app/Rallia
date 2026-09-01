/**
 * useQuickMatch Hooks
 * React Query hooks for the quick game flow: create an open game from a
 * community chat with the bare minimum (when + format).
 *
 * The chat announcement is NOT posted from here. The post_match_to_network_chats
 * trigger already posts a 'match_share' card into every network chat the creator
 * belongs to the moment the row lands, respecting each network's sport scope and
 * the creator's visible_in_* flags. Posting from the client too would double up.
 * We only invalidate the conversation so the trigger's card appears immediately.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createMatch, type CreateMatchInput } from '@rallia/shared-services';
import type { Match } from '@rallia/shared-types';

import { chatKeys } from './useChat';
import { matchKeys } from './useCreateMatch';

export interface CreateQuickMatchInput {
  /** Everything the game itself needs. Defaults are resolved by the caller. */
  match: CreateMatchInput;
  /** The community chat the game is announced in, refreshed after creation. */
  conversationId: string;
}

export function useCreateQuickMatch() {
  const queryClient = useQueryClient();

  return useMutation<Match, Error, CreateQuickMatchInput>({
    mutationFn: input => createMatch(input.match),

    onSuccess: (match, variables) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.messages(variables.conversationId) });
      queryClient.invalidateQueries({ queryKey: matchKeys.lists() });
      queryClient.invalidateQueries({ queryKey: matchKeys.byCreator(match.created_by) });
    },
  });
}

export default useCreateQuickMatch;
