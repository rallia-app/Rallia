/**
 * One-click join for the weekly check-in "Games for you" step.
 *
 * Wraps the joinMatch service (which decides joined/requested/waitlisted from
 * join_mode + capacity, enforces the gender gate, and fires the host/participant
 * notifications) and layers on the caller-side concerns the detail sheet
 * normally owns: analytics, query invalidation, haptics, and a toast — minus the
 * MatchDetailSheet round-trip.
 *
 * Tracks a per-match outcome so the card CTA can flip to a disabled
 * "Joined" / "Requested" state, and a single in-flight id so the row that was
 * tapped shows a spinner without locking the whole list.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { joinMatch } from '@rallia/shared-services';
import { matchKeys } from '@rallia/shared-hooks';
import { useToast } from '@rallia/shared-components';
import { errorHaptic, mediumHaptic, successHaptic } from '@rallia/shared-utils';
import type { MatchWithDetails } from '@rallia/shared-types';

import * as Analytics from '#/services/analytics';
import { useTranslation } from '#/hooks';

export type JoinOutcome = 'joined' | 'requested' | 'waitlisted';

const DEFAULT_DISCOVERY_SOURCE = 'weekly_checkin';

function spotsLeft(match: MatchWithDetails): number {
  const total = match.format === 'doubles' ? 4 : 2;
  const joined = match.participants?.filter(p => p.status === 'joined').length ?? 0;
  return Math.max(0, total - joined);
}

export function useJoinOpportunity(
  playerId: string | null,
  discoverySource: string = DEFAULT_DISCOVERY_SOURCE
) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  const [outcomes, setOutcomes] = useState<Record<string, JoinOutcome>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const join = useCallback(
    async (match: MatchWithDetails) => {
      if (!playerId || pendingId) return;
      mediumHaptic();
      setPendingId(match.id);

      const sport_id = match.sport?.id ?? 'unknown';
      const sport_name = match.sport?.name ?? 'unknown';
      const is_auto_generated = match.is_auto_generated ?? false;
      const fillsMatch = spotsLeft(match) === 1; // joining takes the last spot

      try {
        const result = await joinMatch(match.id, playerId);
        setOutcomes(prev => ({ ...prev, [match.id]: result.status }));
        successHaptic();

        if (result.status === 'joined') {
          Analytics.matchJoined({
            match_id: match.id,
            sport_id,
            sport_name,
            is_auto_generated,
            discovery_source: discoverySource,
          });
          if (fillsMatch) {
            Analytics.matchFilled({
              match_id: match.id,
              sport_id,
              sport_name,
              format: match.format ?? 'unknown',
              is_auto_generated,
              discovery_source: discoverySource,
            });
          }
          toast.success(t('matchActions.joinSuccess'));
        } else if (result.status === 'waitlisted') {
          Analytics.waitlistJoined({ match_id: match.id, sport_id, sport_name });
          toast.success(t('matchActions.waitlistSuccess'));
        } else {
          Analytics.matchJoinRequested({
            match_id: match.id,
            sport_id,
            sport_name,
            is_auto_generated,
            discovery_source: discoverySource,
          });
          toast.success(t('matchActions.requestSent'));
        }

        qc.invalidateQueries({ queryKey: matchKeys.lists() });
      } catch (err) {
        errorHaptic();
        const message = (err as Error)?.message;
        toast.error(
          message === 'GENDER_MISMATCH' ? t('matchActions.genderMismatch') : (message ?? '')
        );
      } finally {
        setPendingId(null);
      }
    },
    [playerId, pendingId, qc, toast, t, discoverySource]
  );

  return { join, outcomes, pendingId };
}
