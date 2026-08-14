/**
 * Handles taps on links inside chat messages.
 *
 * Rallia match links resolve to the match-detail sheet instead of bouncing the
 * user out to the website. Everything else opens externally as before.
 */

import { useCallback } from 'react';
import { Linking } from 'react-native';
import { useToast } from '@rallia/shared-components';
import { getMatchWithDetails } from '@rallia/shared-services';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { useMatchDetailSheet } from '#/context/MatchDetailSheetContext';
import { useTranslation } from '#/hooks';
import { parseRalliaLink } from '#/utils/ralliaLink';

export function useChatLinkPress(): (url: string) => void {
  const { openSheet } = useMatchDetailSheet();
  const { t } = useTranslation();
  const toast = useToast();

  return useCallback(
    (url: string) => {
      const target = parseRalliaLink(url);

      if (target?.kind !== 'match') {
        void Linking.openURL(url);
        return;
      }

      void getMatchWithDetails(target.matchId)
        .then(match => {
          if (match) {
            openSheet(match as MatchDetailData, { source: 'chat_link' });
          } else {
            toast.error(t('chat.message.matchUnavailable'));
          }
        })
        // Only reachable if the match query itself fails (offline, RLS). The web
        // page handles auth and onboarding, so it is the better fallback here.
        .catch(() => Linking.openURL(url));
    },
    [openSheet, t, toast]
  );
}
