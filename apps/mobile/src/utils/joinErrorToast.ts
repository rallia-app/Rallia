/**
 * Maps a join-flow error (from request_to_join_community / join_group_by_invite_code
 * and friends) into a user-facing toast message.
 *
 * Thin preset over rpcErrorMessage with the join-gate codes.
 */

import type { TranslationKey } from '#/hooks';
import { rpcErrorMessage } from './rpcErrorMessage';

type Translator = (key: TranslationKey) => string;

export function getJoinErrorToastMessage(error: unknown, t: Translator): string {
  return rpcErrorMessage(error, t, 'inviteScanner.joinFailedMessage', {
    RATING_TOO_LOW: 'community.ratingRequirementNotMet',
    CERTIFIED_REQUIRED: 'community.ratingRequirementCertifiedNeeded',
    RATING_REQUIRED: 'inviteScanner.ratingRequiredGeneric',
    ALREADY_MEMBER: 'community.qrScanner.alreadyMember',
    PENDING_REQUEST: 'inviteScanner.pendingRequestExists',
  });
}
