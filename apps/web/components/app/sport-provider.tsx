'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePostHog } from 'posthog-js/react';
import {
  deriveActiveSports,
  playerSportsKeys,
  usePlayerSports,
  type ActiveSport,
} from '@rallia/shared-hooks';

import { writeSportCookieClient } from '@/lib/app/sport-cookie';

export type Sport = ActiveSport;

/**
 * Mirrors apps/mobile/src/context/SportContext's value shape so feature code ported
 * from mobile compiles against `useSport()` unchanged.
 *
 * `setSelectedSportsOrdered` is deliberately absent: it exists on mobile only for the
 * guest-facing first-run sport picker, and the player app is authenticated throughout.
 */
interface SportContextValue {
  selectedSport: Sport | null;
  userSports: Sport[];
  isLoading: boolean;
  setSelectedSport: (sport: Sport) => Promise<void>;
  refetch: () => void;
}

const SportContext = createContext<SportContextValue | undefined>(undefined);

interface SportProviderProps {
  children: React.ReactNode;
  userId: string;
  /**
   * Sport id from the cookie, read server-side. Lets the first paint pick the right
   * sport instead of flashing the primary one and then correcting.
   */
  initialSportId: string | null;
}

export function SportProvider({ children, userId, initialSportId }: SportProviderProps) {
  const { playerSports, loading, refetch } = usePlayerSports(userId);
  const queryClient = useQueryClient();
  const posthog = usePostHog();

  const [overrideSportId, setOverrideSportId] = useState<string | null>(initialSportId);

  const { userSports, primarySport } = useMemo(
    () => deriveActiveSports(playerSports),
    [playerSports]
  );

  // Derived rather than stored, so a sport that disappears from the roster (deactivated,
  // or the cookie carries a stale id) falls back instead of leaving a dangling selection.
  const selectedSport = useMemo(() => {
    const chosen = overrideSportId
      ? (userSports.find(sport => sport.id === overrideSportId) ?? null)
      : null;
    return chosen ?? primarySport ?? userSports[0] ?? null;
  }, [overrideSportId, userSports, primarySport]);

  const setSelectedSport = useCallback(
    async (sport: Sport) => {
      writeSportCookieClient(sport.id);
      setOverrideSportId(sport.id);
      posthog?.capture('sport_mode_switched', { sport_name: sport.name });

      // Nearly every player query is sport-scoped. Without this the previous sport's
      // list stays on screen until its own refetch lands.
      await queryClient.invalidateQueries({ queryKey: playerSportsKeys.all });
    },
    [posthog, queryClient]
  );

  // The hook's refetch resolves a promise; mobile's contract is fire-and-forget, so
  // discard it here rather than widening the shared signature.
  const value = useMemo<SportContextValue>(
    () => ({
      selectedSport,
      userSports,
      isLoading: loading,
      setSelectedSport,
      refetch: () => void refetch(),
    }),
    [selectedSport, userSports, loading, setSelectedSport, refetch]
  );

  return <SportContext.Provider value={value}>{children}</SportContext.Provider>;
}

export function useSport(): SportContextValue {
  const context = useContext(SportContext);
  if (!context) {
    throw new Error('useSport must be used within a SportProvider');
  }
  return context;
}
