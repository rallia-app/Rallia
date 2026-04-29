/**
 * useSuggestionInviteHandler
 *
 * Single source of truth for the per-card invite state, the
 * createMatchFromSuggestion call, and the labels used by every surface that
 * renders a SuggestionCard (Home, Public Matches, MatchSuggestionsSheet,
 * onboarding SuggestionsStep).
 *
 * Invite state is keyed by (opponentId, facilityId, startTimeISO) so the same
 * opponent re-suggested at a different time renders as 'idle'. The match list
 * queries are invalidated on success; suggestion queries are intentionally NOT
 * invalidated so the just-invited card stays in place with its 'sent' badge.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createMatchFromSuggestion } from '@rallia/shared-services';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { usePlayerSports } from '@rallia/shared-hooks';
import { usePlayer } from '@rallia/shared-hooks';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';
import { useActionsSheet, useSport } from '../context';
import type {
  InvitePayload,
  InviteState,
  SuggestionCardLabels,
} from '../components/SuggestionCard';

export function suggestionSlotKey(
  opponentId: string,
  facilityId: string,
  startTime: Date | string
): string {
  const iso = typeof startTime === 'string' ? startTime : startTime.toISOString();
  return `${opponentId}|${facilityId}|${iso}`;
}

export interface UseSuggestionInviteHandlerOptions {
  /** Override the sport pulled from `useSport()`. Useful when a surface drives
   *  its own selected-sport state (e.g. the onboarding wizard). */
  sportId?: string;
  /** Override the caller pulled from `usePlayer()` / `useAuth()`. */
  playerId?: string;
  /** Pre-hook that fires before the default `openAuthSheet()` when the caller
   *  is signed out — for surfaces that must dismiss themselves first. */
  onAuthRequired?: () => void;
  /** Fires after a successful invite. Surface-specific side effects
   *  (analytics, telemetry) belong here. */
  onSendSuccess?: (payload: InvitePayload, slotKey: string) => void;
}

export interface UseSuggestionInviteHandlerResult {
  cardLabels: SuggestionCardLabels;
  inviteStates: Record<string, InviteState>;
  getInviteState: (opponentId: string, facilityId: string, startTime: Date | string) => InviteState;
  handleSendInvite: (payload: InvitePayload) => Promise<void>;
}

export function useSuggestionInviteHandler(
  options: UseSuggestionInviteHandlerOptions | string = {}
): UseSuggestionInviteHandlerResult {
  // Back-compat: allow passing a bare sportId string.
  const opts: UseSuggestionInviteHandlerOptions =
    typeof options === 'string' ? { sportId: options } : options;
  const { sportId: optionSportId, playerId: optionPlayerId, onAuthRequired, onSendSuccess } = opts;

  const { t } = useTranslation();
  const { session } = useAuth();
  const { player } = usePlayer();
  const { selectedSport } = useSport();
  const { openSheet: openAuthSheet } = useActionsSheet();
  const { playerSports } = usePlayerSports(session?.user?.id);
  const queryClient = useQueryClient();

  const sportId = selectedSport?.id ?? optionSportId;
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
        onAuthRequired?.();
        openAuthSheet();
        return;
      }

      const key = suggestionSlotKey(
        payload.suggestion.opponentId,
        payload.selectedFacility.facilityId,
        payload.selectedTime
      );
      if (inviteStatesRef.current[key] === 'sending' || inviteStatesRef.current[key] === 'sent') {
        return;
      }

      setInviteStates(prev => ({ ...prev, [key]: 'sending' }));
      try {
        await createMatchFromSuggestion({
          createdBy: optionPlayerId ?? player?.id ?? session?.user?.id ?? '',
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
        setInviteStates(prev => ({ ...prev, [key]: 'sent' }));
        queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'player'] });
        queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'nearby'] });
        queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'public'] });
        onSendSuccess?.(payload, key);
      } catch {
        setInviteStates(prev => ({ ...prev, [key]: 'idle' }));
      }
    },
    [
      optionPlayerId,
      player?.id,
      session?.user,
      sportId,
      callerDuration,
      callerMatchType,
      queryClient,
      openAuthSheet,
      onAuthRequired,
      onSendSuccess,
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
    (opponentId: string, facilityId: string, startTime: Date | string): InviteState =>
      inviteStates[suggestionSlotKey(opponentId, facilityId, startTime)] ?? 'idle',
    [inviteStates]
  );

  return { cardLabels, inviteStates, getInviteState, handleSendInvite };
}

export default useSuggestionInviteHandler;
