/**
 * Maps a join-flow error (from request_to_join_community / join_group_by_invite_code
 * and friends) into a user-facing toast message.
 *
 * The underlying RPC raises business-logic errors as exceptions with known
 * uppercase prefixes (RATING_TOO_LOW, CERTIFIED_REQUIRED, etc.). Surface them
 * as readable, translated strings instead of leaking the raw prefix.
 */

import type { TranslationKey } from '../hooks';

type Translator = (key: TranslationKey) => string;

export function getJoinErrorToastMessage(error: unknown, t: Translator): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message.includes('RATING_TOO_LOW')) {
    return t('community.ratingRequirementNotMet' as TranslationKey);
  }
  if (message.includes('CERTIFIED_REQUIRED')) {
    return t('community.ratingRequirementCertifiedNeeded' as TranslationKey);
  }
  if (message.includes('RATING_REQUIRED')) {
    return t('inviteScanner.ratingRequiredGeneric' as TranslationKey);
  }
  if (message.includes('ALREADY_MEMBER')) {
    return t('community.qrScanner.alreadyMember' as TranslationKey);
  }
  if (message.includes('PENDING_REQUEST')) {
    return t('inviteScanner.pendingRequestExists' as TranslationKey);
  }

  // Unknown error — surface the raw message if it looks human-readable, else fall back.
  if (message && !/^[A-Z_]{4,}/.test(message)) {
    return message;
  }
  return t('inviteScanner.joinFailedMessage' as TranslationKey);
}
