/**
 * useSuggestionInviteHandler
 *
 * Centralizes the per-card invite state and the createMatchFromSuggestion
 * call used by every surface that renders a SuggestionCard inside a feed
 * (Home, Public Matches). Lifted out of SuggestionsFeedSection so multiple
 * lists can share a single invite handler without duplicating plumbing.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createMatchFromSuggestion } from '@rallia/shared-services';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { usePlayerSports, suggestionKeys } from '@rallia/shared-hooks';
import { usePlayer } from '@rallia/shared-hooks';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';
import { useActionsSheet, useSport } from '../context';
import type {
  InvitePayload,
  InviteState,
  SuggestionCardLabels,
} from '../components/SuggestionCard';

export interface UseSuggestionInviteHandlerResult {
  cardLabels: SuggestionCardLabels;
  inviteStates: Record<string, InviteState>;
  getInviteState: (opponentId: string) => InviteState;
  handleSendInvite: (payload: InvitePayload) => Promise<void>;
}

export function useSuggestionInviteHandler(
  fallbackSportId?: string
): UseSuggestionInviteHandlerResult {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { player } = usePlayer();
  const { selectedSport } = useSport();
  const { openSheet: openAuthSheet } = useActionsSheet();
  const { playerSports } = usePlayerSports(session?.user?.id);
  const queryClient = useQueryClient();

  const sportId = selectedSport?.id ?? fallbackSportId;
  const callerSportPrefs = playerSports.find(ps => ps.sport_id === sportId);
  const callerDuration = callerSportPrefs?.preferred_match_duration ?? '60';
  const callerMatchType = callerSportPrefs?.preferred_match_type ?? 'both';

  const [inviteStates, setInviteStates] = useState<Record<string, InviteState>>({});
  const inviteStatesRef = useRef(inviteStates);
  inviteStatesRef.current = inviteStates;

  const handleSendInvite = useCallback(
    async (payload: InvitePayload) => {
      if (!session?.user) {
        lightHaptic();
        openAuthSheet();
        return;
      }

      const id = payload.suggestion.opponentId;
      if (inviteStatesRef.current[id] === 'sending' || inviteStatesRef.current[id] === 'sent') {
        return;
      }

      setInviteStates(prev => ({ ...prev, [id]: 'sending' }));
      try {
        await createMatchFromSuggestion({
          createdBy: player?.id ?? session?.user?.id ?? '',
          opponentId: payload.suggestion.opponentId,
          sportId: sportId ?? '',
          matchType: callerMatchType,
          matchDuration: callerDuration,
          facilityId: payload.selectedFacility.facilityId,
          startTime: payload.selectedTime,
          endTime: payload.selectedEndTime,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        successHaptic();
        setInviteStates(prev => ({ ...prev, [id]: 'sent' }));
        queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'player'] });
        queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'nearby'] });
        queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'public'] });
        // Drop the just-invited opponent from every suggestion surface so the
        // card doesn't reappear on next render.
        queryClient.invalidateQueries({ queryKey: suggestionKeys.all });
      } catch {
        setInviteStates(prev => ({ ...prev, [id]: 'idle' }));
      }
    },
    [
      player?.id,
      session?.user,
      sportId,
      callerDuration,
      callerMatchType,
      queryClient,
      openAuthSheet,
    ]
  );

  const cardLabels: SuggestionCardLabels = useMemo(
    () => ({
      facility: t('onboarding.suggestions.facility'),
      when: t('onboarding.suggestions.when'),
      noAvailableTimes: t('onboarding.suggestions.noAvailableTimes'),
      unknownPlayer: t('onboarding.suggestions.unknownPlayer'),
      sendInvite: t('onboarding.suggestions.sendInvite'),
      inviteSent: t('onboarding.suggestions.inviteSent'),
      periodMorning: t('onboarding.suggestions.periodMorning'),
      periodAfternoon: t('onboarding.suggestions.periodAfternoon'),
      periodEvening: t('onboarding.suggestions.periodEvening'),
      today: t('common.time.today'),
      tomorrow: t('common.time.tomorrow'),
      selectDate: t('onboarding.suggestions.selectDate'),
      selectTime: t('onboarding.suggestions.selectTime'),
    }),
    [t]
  );

  const getInviteState = useCallback(
    (opponentId: string): InviteState => inviteStates[opponentId] ?? 'idle',
    [inviteStates]
  );

  return { cardLabels, inviteStates, getInviteState, handleSendInvite };
}

export default useSuggestionInviteHandler;
