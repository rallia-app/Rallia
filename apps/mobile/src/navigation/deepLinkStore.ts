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

export interface PendingReferral {
  code: string;
  type: InvitationType;
  targetId?: string;
}

export type DeepLinkPayload =
  | { type: 'match'; matchId: string }
  | { type: 'group'; inviteCode: string }
  | { type: 'community'; inviteCode: string }
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

export function setPendingDeepLink(payload: DeepLinkPayload): void {
  _pending = payload;
  // Fire-and-forget: persist to AsyncStorage for post-onboarding flow
  persistToAsyncStorage(payload);
}

export function consumePendingDeepLink(): DeepLinkPayload | null {
  const p = _pending;
  _pending = null;
  return p;
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
  }
  AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(referral)).catch(() => {});
}
