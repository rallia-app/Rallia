/**
 * useTourSequence - Manages the sequence of screen-specific tours
 *
 * Triggers a screen-specific tour on first visit, but only after the main
 * navigation tour has been completed and once data on the screen is ready.
 *
 * Tour sequence:
 * 1. Main Navigation Tour (tabs) - triggered by WelcomeTourModal
 * 2. Home / Profile / Chat / Match-creation tours - triggered on first visit
 *    once main_navigation is complete
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTour } from '../context/TourContext';
import { TourId } from '@rallia/shared-services';
import { Logger } from '@rallia/shared-services';

export const SCREEN_TOURS: Record<string, TourId> = {
  home: 'home_screen',
  profile: 'profile_screen',
  chat: 'chat_screen',
  match_creation: 'create_match',
};

interface UseTourSequenceOptions {
  screenId: keyof typeof SCREEN_TOURS;
  isReady?: boolean;
  delay?: number;
  autoStart?: boolean;
}

interface UseTourSequenceResult {
  shouldShowTour: boolean;
  startScreenTour: () => void;
  isTourCompleted: boolean;
  skipScreenTour: () => void;
}

export const useTourSequence = ({
  screenId,
  isReady = true,
  delay = 500,
  autoStart = false,
}: UseTourSequenceOptions): UseTourSequenceResult => {
  const tourId = SCREEN_TOURS[screenId];
  const {
    startTour,
    completeTour,
    isTourCompleted: isTourCompletedFn,
    activeTourId,
    isLoading,
  } = useTour();

  // Stash the latest tour state in refs so the auto-start effect can read it
  // without listing them as dependencies (which previously caused an infinite
  // loop: completion writes -> tourStatus update -> effect re-run -> start).
  const isTourCompletedRef = useRef(isTourCompletedFn);
  isTourCompletedRef.current = isTourCompletedFn;

  const activeTourIdRef = useRef(activeTourId);
  activeTourIdRef.current = activeTourId;

  const startTourRef = useRef(startTour);
  startTourRef.current = startTour;

  // Per-mount guard: only attempt auto-start once per screen mount.
  const hasAttemptedRef = useRef(false);

  useEffect(() => {
    if (!autoStart) return;
    if (isLoading) return;
    if (!isReady) return;
    if (hasAttemptedRef.current) return;

    // Wait for the main navigation tour to be done before any screen tour.
    if (!isTourCompletedRef.current('main_navigation')) return;

    // Don't auto-start if this screen's tour is already done.
    if (isTourCompletedRef.current(tourId)) return;

    // Don't start if another tour is currently active.
    if (activeTourIdRef.current) return;

    hasAttemptedRef.current = true;

    const timeout = setTimeout(() => {
      // Re-check active tour at fire time in case one started during the delay.
      if (activeTourIdRef.current) return;
      if (isTourCompletedRef.current(tourId)) return;
      Logger.logUserAction('tour_auto_start', { screenId, tourId });
      startTourRef.current(tourId).catch((error: unknown) => {
        Logger.error('Auto-start tour failed', error as Error, { tourId });
      });
    }, delay);

    return () => clearTimeout(timeout);
    // Intentionally omit refs and tourId (stable per screen) from deps.
  }, [autoStart, isLoading, isReady, delay, screenId, tourId]);

  const startScreenTour = useCallback(() => {
    if (activeTourIdRef.current) return;
    startTourRef.current(tourId).catch((error: unknown) => {
      Logger.error('Manual start tour failed', error as Error, { tourId });
    });
  }, [tourId]);

  const skipScreenTour = useCallback(() => {
    completeTour(tourId).catch((error: unknown) => {
      Logger.error('Skip tour failed', error as Error, { tourId });
    });
  }, [completeTour, tourId]);

  const isTourCompleted = isTourCompletedFn(tourId);
  const shouldShowTour =
    !isLoading &&
    isReady &&
    isTourCompletedFn('main_navigation') &&
    !isTourCompleted &&
    !activeTourId;

  return {
    shouldShowTour,
    startScreenTour,
    isTourCompleted,
    skipScreenTour,
  };
};

export default useTourSequence;
