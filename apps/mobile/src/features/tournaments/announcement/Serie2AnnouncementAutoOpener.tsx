/**
 * Serie2AnnouncementAutoOpener — presents the Série 2 announcement screen
 * once per player, after launch, when it's safe and RELEVANT to do so.
 *
 * Same recipe as the Série 1 opener (splash + sport-selection + auth +
 * onboarding gates, settle delay, never on top of the check-in wizard or an
 * open sheet, AsyncStorage once-flag, hard campaign end), except it navigates
 * to a full-screen modal instead of showing a sheet.
 *
 * Data-driven trigger:
 *   - only for players who play tennis (Série 2 is tennis-only);
 *   - only while a Série 2 draw is actually open for registration — activates
 *     by itself when registrations open and stops pitching once they close;
 *   - the content is personal: serie2Relevance picks the viewer's Série 1
 *     winner and their one best-fit Série 2 draw from the fetched data. The
 *     champions/entries reads are non-fatal — the pitch still stands without
 *     the recap.
 */
import React, { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSheetStack } from 'react-native-actions-sheet';
import {
  Logger,
  listPublicTournaments,
  listSeriesChampions,
  listMyRegisteredTournamentIds,
} from '@rallia/shared-services';
import { useAuth, useProfile, usePlayer } from '@rallia/shared-hooks';

import { useOverlay, useSport } from '#/context';
import { navigationRef } from '#/navigation/navigationRef';
import { isWeeklyCheckInActive } from '#/features/weekly-checkin/isWizardActive';
import { IS_E2E } from '#/utils/e2e';

import type { Serie2AnnouncementDraw } from './serie2AnnouncementTypes';
import { selectSerie2Announcement, type SeriesChampionInput } from './serie2Relevance';

const SERIE2_SHOWN_KEY = '@rallia/serie2-announcement-shown';
// Match the seeded tournament names (data, not copy). Série 1 was renamed by
// the regional split (20260725150000), so both series read 'Série N Zone · …'.
const SERIE2_NAME_PREFIX = 'Série 2';
const SERIE1_NAME_PREFIX = 'Série 1';
// Past this date the campaign is over for good: persist the flag and stop
// querying on every launch. Kept a day past the August 21 close as a buffer.
const CAMPAIGN_END_ISO = '2026-08-23T00:00:00-04:00';
// Let the home screen settle before presenting.
const OPEN_DELAY_MS = 700;

// ⚠️ TEMPORARY (dev only): set to true to reopen the announcement on every
// launch, bypassing the once-per-install "already shown" flag, while iterating
// on the UI. Guarded by __DEV__ below so it can never affect production builds.
const FORCE_SHOW = false;

interface Serie2AnnouncementAutoOpenerProps {
  isSplashComplete: boolean;
}

export const Serie2AnnouncementAutoOpener: React.FC<Serie2AnnouncementAutoOpenerProps> = ({
  isSplashComplete,
}) => {
  const { session } = useAuth();
  const isAuthed = !!session?.user;
  const userId = session?.user?.id ?? null;
  const { profile } = useProfile();
  const isOnboardingComplete = !!profile?.onboarding_completed;
  const { isSportSelectionComplete } = useOverlay();
  const { userSports, isLoading: sportsLoading } = useSport();
  const { player, loading: playerLoading, sportRatings } = usePlayer();

  // Evaluate at most once per app session.
  const openedRef = useRef(false);

  useEffect(() => {
    if (IS_E2E) return;
    if (openedRef.current) return;
    if (!isSplashComplete || !isSportSelectionComplete) return;
    if (!isAuthed || !isOnboardingComplete) return;
    if (sportsLoading || playerLoading) return;

    openedRef.current = true;

    // From here the flow must NOT be cancellable: the effect's object deps
    // (player, sportRatings, userSports) get replaced by late query settles,
    // and a cleanup-on-dep-change during the fetch + settle delay would
    // silently drop the one presentation this session gets. openedRef already
    // guarantees re-runs are no-ops, so the chain just runs to completion.
    void (async () => {
      const forceShow = __DEV__ && FORCE_SHOW;

      let alreadyShown = false;
      try {
        alreadyShown = (await AsyncStorage.getItem(SERIE2_SHOWN_KEY)) === 'true';
      } catch (err) {
        Logger.error('Failed to read Série 2 announcement flag', err as Error);
        return;
      }
      if (alreadyShown && !forceShow) return;

      // Campaign over → persist and never query again.
      if (Date.now() > new Date(CAMPAIGN_END_ISO).getTime() && !forceShow) {
        AsyncStorage.setItem(SERIE2_SHOWN_KEY, 'true').catch(err =>
          Logger.error('Failed to persist Série 2 announcement flag', err as Error)
        );
        return;
      }

      // Série 2 is tennis: skip quietly (and retry later — a player can add
      // tennis to their sports at any time during the window).
      const tennis = userSports.find(s => s.name === 'tennis');
      if (!tennis) return;

      // Data-driven trigger: only pitch while registration is actually open.
      let draws: Serie2AnnouncementDraw[] = [];
      try {
        const tournaments = await listPublicTournaments();
        draws = tournaments
          .filter(tn => tn.status === 'registration_open' && tn.name.startsWith(SERIE2_NAME_PREFIX))
          .map(tn => ({
            id: tn.id,
            name: tn.name,
            entryFeeCents: tn.entry_fee_cents ?? 0,
            currency: tn.currency,
            registrationClosesAt: tn.registration_closes_at,
            prizeMoneyCents: tn.prize_money_cents,
            prizeIsProrated: tn.prize_is_prorated,
            prizeTopShareBps: tn.prize_top_share_bps,
            minRating: tn.min_rating,
            maxRating: tn.max_rating,
            latitude: tn.latitude,
            longitude: tn.longitude,
            spotsLeft:
              tn.max_participants != null
                ? Math.max(0, tn.max_participants - tn.registration_count)
                : null,
          }));
      } catch (err) {
        Logger.error('Failed to check Série 2 tournaments for announcement', err as Error);
        return;
      }
      if (draws.length === 0 && !forceShow) return;

      // The personal half: the Série 1 winners and the viewer's own entry.
      // Non-fatal — the pitch still stands without the recap.
      let champions: SeriesChampionInput[] = [];
      let myTournamentIds: string[] = [];
      try {
        champions = (await listSeriesChampions(SERIE1_NAME_PREFIX)).map(c => ({
          tournamentId: c.tournamentId,
          tournamentName: c.tournamentName,
          championName: c.championName,
          championUserId: c.championUserId,
          championPartnerUserId: c.championPartnerUserId,
        }));
        if (userId && champions.length > 0) {
          myTournamentIds = await listMyRegisteredTournamentIds(
            userId,
            champions.map(c => c.tournamentId)
          );
        }
      } catch (err) {
        Logger.error('Failed to load Série 1 champions for announcement', err as Error);
      }

      const params = selectSerie2Announcement({
        champions,
        draws,
        myTournamentIds,
        myUserId: userId,
        rating: sportRatings[tennis.id]?.value ?? null,
        latitude: player?.latitude ?? null,
        longitude: player?.longitude ?? null,
      });
      if (!params) return;

      setTimeout(() => {
        // Never stack on top of another pop-up: skip if the weekly check-in
        // wizard is up or any action sheet is already open. The flag is left
        // unset so the announcement is retried on a later launch.
        if (isWeeklyCheckInActive() || getSheetStack().length > 0) return;
        if (!navigationRef.isReady()) return;

        navigationRef.navigate('Serie2Announcement', params);
        // In force-show mode, don't persist the flag so it keeps reopening.
        if (!forceShow) {
          AsyncStorage.setItem(SERIE2_SHOWN_KEY, 'true').catch(err =>
            Logger.error('Failed to persist Série 2 announcement flag', err as Error)
          );
        }
      }, OPEN_DELAY_MS);
    })();
  }, [
    isSplashComplete,
    isSportSelectionComplete,
    isAuthed,
    isOnboardingComplete,
    sportsLoading,
    playerLoading,
    userSports,
    userId,
    player,
    sportRatings,
  ]);

  return null;
};

export default Serie2AnnouncementAutoOpener;
