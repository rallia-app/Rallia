/**
 * Shared feed-item types used by Home and Public Matches.
 *
 * Originally lived alongside `useUnifiedMatchFeed`. The hook itself was
 * retired in Step 6 of the suggestions refactor, but the discriminated-union
 * shape it produced is still useful for consumers that mix matches and
 * suggestions in a single render path (notably FeedItemCard).
 */

import type { SlotSuggestion } from '@rallia/shared-services';
import type { NearbyMatch } from './useNearbyMatches';
import type { PublicMatch } from './usePublicMatches';

export type UnifiedFeedMatch = NearbyMatch | PublicMatch;

export type UnifiedFeedItem =
  | { kind: 'match'; key: string; sortTime: number; data: UnifiedFeedMatch }
  | { kind: 'suggestion'; key: string; sortTime: number; data: SlotSuggestion };
