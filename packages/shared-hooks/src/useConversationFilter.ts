/**
 * useConversationFilter Hook
 * Manages filter state for the chat inbox screen.
 * Uses single-select toggle behavior (WhatsApp-style chips).
 */

import { useState, useCallback, useMemo } from 'react';
import type { ConversationFilter } from '@rallia/shared-types';

export type { ConversationFilter };

/** All available filter options (for UI iteration) */
export const CONVERSATION_FILTER_OPTIONS: ConversationFilter[] = [
  'all',
  'unread',
  'direct',
  'group_chat',
  'player_group',
  'community',
  'club',
  'match',
];

export interface UseConversationFilterReturn {
  filter: ConversationFilter;
  hasActiveFilter: boolean;
  setFilter: (filter: ConversationFilter) => void;
  toggleFilter: (filter: ConversationFilter) => void;
  resetFilter: () => void;
}

export function useConversationFilter(
  initialFilter: ConversationFilter = 'all'
): UseConversationFilterReturn {
  const [filter, setFilterState] = useState<ConversationFilter>(initialFilter);

  const hasActiveFilter = useMemo(() => filter !== 'all', [filter]);

  const setFilter = useCallback((f: ConversationFilter) => {
    setFilterState(f);
  }, []);

  const toggleFilter = useCallback((f: ConversationFilter) => {
    setFilterState(prev => (prev === f ? 'all' : f));
  }, []);

  const resetFilter = useCallback(() => {
    setFilterState('all');
  }, []);

  return { filter, hasActiveFilter, setFilter, toggleFilter, resetFilter };
}
