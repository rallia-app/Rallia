/**
 * Deep Link Store
 *
 * Module-level store that bridges React Navigation's synchronous `getStateFromPath`
 * (which runs outside the React tree) with the Home screen's React effects.
 *
 * Flow:
 * 1. `getStateFromPath` detects a deep link URL and calls `setPendingDeepLink()`
 * 2. Navigation resolves to Main (or PreOnboarding for new users)
 * 3. Home screen calls `consumePendingDeepLink()` on mount, shows a brief overlay, and processes the action
 * 4. Data is also persisted to AsyncStorage for the post-signup/post-onboarding flow
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { InvitationType } from '@rallia/shared-services';

// =============================================================================
// TYPES (moved from InvitationDeepLinkScreen)
// =============================================================================

export const PENDING_REFERRAL_KEY = 'pending_referral_code';
export const ACQUISITION_CHANNEL_KEY = '@rallia/acquisition-channel';

/** Chip ids in PreOnboarding/DiscoveryStep — kept in sync with the CHANNELS array there. */
export type DiscoveryChannelId = 'friend' | 'social' | 'app_store' | 'event' | 'search' | 'other';

export interface PendingReferral {
  code: string;
  type: InvitationType;
  targetId?: string;
  /** True when the user typed the code by hand (DiscoveryStep / PersonalInfoStep). Absent for deep-link / install-referrer / clipboard origins. */
  enteredManually?: boolean;
}

export type DeepLinkPayload =
  | { type: 'match'; matchId: string }
  | { type: 'group'; inviteCode: string }
  | { type: 'community'; inviteCode: string }
  | { type: 'publicMatches' }
  | { type: 'matchupSuggestions' }
  | {
      type: 'invitation';
      referralCode: string;
      invitationType?: InvitationType;
      targetId?: string;
    };

// =============================================================================
// PENDING DEEP LINK
// =============================================================================

let _pending: DeepLinkPayload | null = null;
const _listeners = new Set<() => void>();

export function setPendingDeepLink(payload: DeepLinkPayload): void {
  _pending = payload;
  // Fire-and-forget: persist to AsyncStorage for post-onboarding flow
  persistToAsyncStorage(payload);
  _listeners.forEach(fn => fn());
}

/** Peek at the pending link without consuming it */
export function getPendingDeepLink(): DeepLinkPayload | null {
  return _pending;
}

export function consumePendingDeepLink(): DeepLinkPayload | null {
  const p = _pending;
  _pending = null;
  return p;
}

/** Subscribe to future setPendingDeepLink calls. Returns unsubscribe. */
export function addDeepLinkListener(fn: () => void): () => void {
  _listeners.add(fn);
  return () => void _listeners.delete(fn);
}

// =============================================================================
// SPORT SELECTION STATUS (synchronous mirror for getStateFromPath)
// =============================================================================

let _sportSelectionComplete = false;

export function setSportSelectionComplete(value: boolean): void {
  _sportSelectionComplete = value;
}

export function isSportSelectionComplete(): boolean {
  return _sportSelectionComplete;
}

// =============================================================================
// ASYNC STORAGE PERSISTENCE
// =============================================================================

function persistToAsyncStorage(payload: DeepLinkPayload): void {
  let referral: PendingReferral;
  switch (payload.type) {
    case 'match':
      referral = { code: '', type: 'match', targetId: payload.matchId };
      break;
    case 'group':
      referral = { code: '', type: 'group', targetId: payload.inviteCode };
      break;
    case 'community':
      referral = { code: '', type: 'community', targetId: payload.inviteCode };
      break;
    case 'invitation':
      referral = {
        code: payload.referralCode,
        type: payload.invitationType ?? 'referral',
        targetId: payload.targetId,
      };
      break;
    case 'publicMatches':
      return; // nothing to persist
    case 'matchupSuggestions':
      return; // nothing to persist
  }
  AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(referral)).catch(() => {});
}
