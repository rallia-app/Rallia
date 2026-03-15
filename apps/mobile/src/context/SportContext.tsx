import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePlayerSports } from '@rallia/shared-hooks';

const SPORT_STORAGE_KEY = '@rallia/selected-sport';
const GUEST_SPORTS_STORAGE_KEY = '@rallia/guest-selected-sports';

/**
 * Sport interface for context consumption
 */
export interface Sport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

interface SportContextValue {
  /** Currently selected sport */
  selectedSport: Sport | null;
  /** All sports the user has registered for */
  userSports: Sport[];
  /** Whether sports data is loading */
  isLoading: boolean;
  /** Select a sport */
  setSelectedSport: (sport: Sport) => Promise<void>;
  /** Set sports from ordered selection (first becomes default). Used by first-time sport selection overlay. */
  setSelectedSportsOrdered: (orderedSports: Sport[]) => Promise<void>;
  /** Refetch user sports from the server */
  refetch: () => void;
}

const SportContext = createContext<SportContextValue | undefined>(undefined);

interface SportProviderProps {
  children: ReactNode;
  /** The authenticated user's ID. Pass from your auth context. */
  userId?: string;
}

export function SportProvider({ children, userId }: SportProviderProps) {
  const { playerSports, loading: playerSportsLoading, refetch } = usePlayerSports(userId);
  const [selectedSport, setSelectedSportState] = useState<Sport | null>(null);
  const [allSports, setAllSports] = useState<Sport[]>([]);
  const [guestSportsLoading, setGuestSportsLoading] = useState(!userId); // Start loading if guest

  // Derive userSports from playerSports using useMemo (avoids setState in effect)
  const { userSports, primarySport } = useMemo(() => {
    if (!userId || !playerSports || playerSports.length === 0) {
      return { userSports: [] as Sport[], primarySport: null as Sport | null };
    }

    const sports: Sport[] = [];
    let primary: Sport | null = null;

    playerSports.forEach(ps => {
      const sportData = Array.isArray(ps.sport) ? ps.sport[0] : ps.sport;
      if (
        sportData &&
        typeof sportData === 'object' &&
        ps.is_active === true &&
        sportData.is_active === true
      ) {
        const sport: Sport = {
          id: sportData.id,
          name: sportData.name,
          display_name: sportData.display_name,
          icon_url: sportData.icon_url,
        };
        sports.push(sport);

        if (ps.is_primary) {
          primary = sport;
        }
      }
    });

    return { userSports: sports, primarySport: primary };
  }, [userId, playerSports]);

  // Initialize selected sport from storage or use primary/first sport
  const initializeSelectedSport = useCallback(async (sports: Sport[], primary: Sport | null) => {
    try {
      const savedSportId = await AsyncStorage.getItem(SPORT_STORAGE_KEY);

      if (savedSportId) {
        const savedSport = sports.find(s => s.id === savedSportId);
        if (savedSport) {
          setSelectedSportState(savedSport);
          return;
        }
      }

      const defaultSport = primary || sports[0];
      setSelectedSportState(defaultSport);

      if (defaultSport) {
        await AsyncStorage.setItem(SPORT_STORAGE_KEY, defaultSport.id);
      }
    } catch (error) {
      console.error('Failed to initialize selected sport:', error);
      setSelectedSportState(primary || sports[0] || null);
    }
  }, []);

  // Load guest sports from storage (no userId)
  useEffect(() => {
    if (userId) {
      // Clear all sports when user logs in (will use playerSports instead)
      setAllSports([]);
      setGuestSportsLoading(false);
      return;
    }

    // Check if guest has already selected sports
    AsyncStorage.getItem(GUEST_SPORTS_STORAGE_KEY)
      .then(savedSportsJson => {
        if (savedSportsJson) {
          try {
            const savedSports: Sport[] = JSON.parse(savedSportsJson);
            if (savedSports.length > 0) {
              setAllSports(savedSports);
              initializeSelectedSport(savedSports, null);
              return;
            }
          } catch (parseError) {
            console.error('Failed to parse saved guest sports:', parseError);
          }
        }
        setAllSports([]);
      })
      .catch(error => {
        console.error('Failed to load guest sports:', error);
        setAllSports([]);
      })
      .finally(() => {
        setGuestSportsLoading(false);
      });
  }, [userId, initializeSelectedSport]);

  // Initialize selected sport for authenticated users when sports change
  useEffect(() => {
    if (!userId) return;
    if (playerSportsLoading) return;

    if (userSports.length > 0) {
      initializeSelectedSport(userSports, primarySport);
    } else {
      setSelectedSportState(null);
    }
  }, [userId, userSports, primarySport, playerSportsLoading, initializeSelectedSport]);

  // Sync authenticated user's sports to AsyncStorage
  // This ensures guest sports storage stays up-to-date with the user's current preferences
  // So if they sign out, their sport preferences persist
  useEffect(() => {
    if (!userId) return; // Only for authenticated users
    if (playerSportsLoading) return; // Wait until loading is complete
    if (userSports.length === 0) return; // Don't overwrite with empty array

    AsyncStorage.setItem(GUEST_SPORTS_STORAGE_KEY, JSON.stringify(userSports)).catch(error => {
      console.error('[SportProvider] Failed to sync user sports to AsyncStorage:', error);
    });
  }, [userId, userSports, playerSportsLoading]);

  const setSelectedSport = useCallback(async (sport: Sport) => {
    try {
      await AsyncStorage.setItem(SPORT_STORAGE_KEY, sport.id);
      setSelectedSportState(sport);
    } catch (error) {
      console.error('Failed to save selected sport:', error);
      // Still update state even if storage fails
      setSelectedSportState(sport);
    }
  }, []);

  /**
   * Set sports from an ordered selection (first-time user flow).
   * The first sport in the array becomes the default selected sport.
   * For guest users, only the selected sports will be available.
   */
  const setSelectedSportsOrdered = useCallback(
    async (orderedSports: Sport[]) => {
      if (orderedSports.length === 0) return;

      const primarySport = orderedSports[0];

      try {
        // Save the first selected sport as the current selection
        await AsyncStorage.setItem(SPORT_STORAGE_KEY, primarySport.id);
        setSelectedSportState(primarySport);

        // For guest users, save and use only the selected sports
        if (!userId) {
          // Persist the guest's sport selection
          await AsyncStorage.setItem(GUEST_SPORTS_STORAGE_KEY, JSON.stringify(orderedSports));
          // Set only the selected sports as available
          setAllSports(orderedSports);
        }
      } catch (error) {
        console.error('Failed to save ordered sport selection:', error);
        // Still update state even if storage fails
        setSelectedSportState(primarySport);
        if (!userId) {
          setAllSports(orderedSports);
        }
      }
    },
    [userId]
  );

  // For guest users, use allSports; for authenticated users, use userSports
  const availableSports = userId ? userSports : allSports;
  const isLoading = userId ? playerSportsLoading : guestSportsLoading;

  const value: SportContextValue = {
    selectedSport,
    userSports: availableSports,
    isLoading,
    setSelectedSport,
    setSelectedSportsOrdered,
    refetch,
  };

  return <SportContext.Provider value={value}>{children}</SportContext.Provider>;
}

/**
 * Hook to access sport context
 *
 * @example
 * ```tsx
 * const { selectedSport, userSports, setSelectedSport } = useSport();
 *
 * // Display current sport
 * <Text>{selectedSport?.display_name}</Text>
 *
 * // Change sport
 * const handleSportChange = (sport: Sport) => setSelectedSport(sport);
 * ```
 */
export function useSport(): SportContextValue {
  const context = useContext(SportContext);
  if (context === undefined) {
    throw new Error('useSport must be used within a SportProvider');
  }
  return context;
}

export { SportContext };
