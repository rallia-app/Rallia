/**
 * useSuggestionInviteHandler
 *
 * Single source of truth for the per-card invite state, the
 * createMatchFromSuggestion call, and the labels used by every surface that
 * renders a SuggestionCard (Home, Public Matches, MatchSuggestionsSheet,
 * onboarding SuggestionsStep).
 *
 * Invite state is keyed by (opponentId, facilityId, startTimeISO) so the same
 * opponent re-suggested at a different time renders as 'idle'.
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
import * as Analytics from '../services/analytics';
import type { SuggestionSource } from '../services/analytics';
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
  sportId?: string;
  playerId?: string;
  /** Where this hook is being used — propagates into the
   *  `match_suggestion_invite_sent` analytics event for breakdowns. */
  source?: SuggestionSource;
  onAuthRequired?: () => void;
  onSendSuccess?: (payload: InvitePayload, slotKey: string) => void;
}

export interface UseSuggestionInviteHandlerResult {
  cardLabels: SuggestionCardLabels;
  inviteStates: Record<string, InviteState>;
  getInviteState: (opponentId: string, facilityId: string, startTime: Date | string) => InviteState;
  handleSendInvite: (payload: InvitePayload) => Promise<void>;
  /** Caller's preferred match type for the active sport — fed into SuggestionCard so its default chip row reflects what the match becomes on accept. */
  callerMatchType: 'competitive' | 'casual' | 'both';
}

export function useSuggestionInviteHandler(
  options: UseSuggestionInviteHandlerOptions | string = {}
): UseSuggestionInviteHandlerResult {
  const opts: UseSuggestionInviteHandlerOptions =
    typeof options === 'string' ? { sportId: options } : options;
  const {
    sportId: optionSportId,
    playerId: optionPlayerId,
    source,
    onAuthRequired,
    onSendSuccess,
  } = opts;

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

      const { suggestion } = payload;
      const slotStart =
        suggestion.slot.datetime instanceof Date
          ? suggestion.slot.datetime
          : new Date(suggestion.slot.datetime);
      const slotEnd =
        suggestion.slot.endDatetime instanceof Date
          ? suggestion.slot.endDatetime
          : new Date(suggestion.slot.endDatetime);

      const key = suggestionSlotKey(
        suggestion.opponentId,
        suggestion.facility.facilityId,
        slotStart
      );
      if (inviteStatesRef.current[key] === 'sending' || inviteStatesRef.current[key] === 'sent') {
        return;
      }

      setInviteStates(prev => ({ ...prev, [key]: 'sending' }));
      try {
        const result = await createMatchFromSuggestion({
          createdBy: optionPlayerId ?? player?.id ?? session?.user?.id ?? '',
          opponentId: suggestion.opponentId,
          sportId: sportId ?? '',
          matchType: callerMatchType,
          matchDuration: callerDuration,
          facilityId: suggestion.facility.facilityId,
          startTime: slotStart,
          endTime: slotEnd,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        successHaptic();
        setInviteStates(prev => ({ ...prev, [key]: 'sent' }));
        if (source) {
          Analytics.matchSuggestionInviteSent({
            source,
            opponent_id: suggestion.opponentId,
            facility_id: suggestion.facility.facilityId,
            slot_start: slotStart.toISOString(),
            match_id: result.matchId,
            sport_id: sportId,
            sport_name: selectedSport?.id === sportId ? selectedSport?.name : undefined,
            score: suggestion.score,
            player_compatibility: suggestion.playerCompatibility,
            facility_affinity: suggestion.facility.facilityAffinity,
            rank: suggestion.rank,
            match_type: suggestion.matchType,
            match_duration: suggestion.matchDuration,
          });
        }
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
      source,
      selectedSport?.id,
      selectedSport?.name,
    ]
  );

  const cardLabels: SuggestionCardLabels = useMemo(
    () => ({
      unknownPlayer: t('onboarding.suggestions.unknownPlayer'),
      sendInvite: t('onboarding.suggestions.sendInvite'),
      inviteSent: t('onboarding.suggestions.inviteSent'),
      today: t('common.time.today'),
      tomorrow: t('common.time.tomorrow'),
      singles: t('match.format.singles'),
      free: t('match.cost.free'),
      competitive: t('match.type.competitive'),
      casual: t('match.type.casual'),
    }),
    [t]
  );

  const getInviteState = useCallback(
    (opponentId: string, facilityId: string, startTime: Date | string): InviteState =>
      inviteStates[suggestionSlotKey(opponentId, facilityId, startTime)] ?? 'idle',
    [inviteStates]
  );

  const normalizedCallerMatchType: 'competitive' | 'casual' | 'both' =
    callerMatchType === 'competitive' || callerMatchType === 'casual' ? callerMatchType : 'both';

  return {
    cardLabels,
    inviteStates,
    getInviteState,
    handleSendInvite,
    callerMatchType: normalizedCallerMatchType,
  };
}

export default useSuggestionInviteHandler;
