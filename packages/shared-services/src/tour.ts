/**
 * Tour Service - Persistence layer for tour/walkthrough completion status
 *
 * This service handles storing and retrieving tour completion status
 * using a storage adapter. It's designed to work with the TourContext
 * to track which tours users have completed.
 */

import { Logger } from './logger';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Available tour IDs in the app
 */
export type TourId =
  | 'welcome' // Initial welcome tour for new users
  | 'main_navigation' // Tour of bottom tab navigation
  | 'home_screen' // Home screen features tour
  | 'matches_screen' // Matches/Games screen tour
  | 'create_match' // Match creation flow tour
  | 'chat_screen' // Chat features tour
  | 'profile_screen' // Profile and settings tour
  | 'notifications_screen'; // Notifications tour

/**
 * Tour status mapping - true means completed
 */
export type TourStatus = Partial<Record<TourId, boolean>>;

/**
 * Storage adapter interface for tour persistence.
 * Allows using different storage backends (AsyncStorage, localStorage, etc.)
 */
export interface TourStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  multiGet(keys: readonly string[]): Promise<ReadonlyArray<[string, string | null]>>;
  multiSet(pairs: ReadonlyArray<[string, string]>): Promise<void>;
}

/**
 * In-memory storage adapter (fallback for web or testing)
 */
const memoryStorage: Map<string, string> = new Map();

export const inMemoryStorageAdapter: TourStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    return memoryStorage.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    memoryStorage.set(key, value);
  },
  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    return keys.map(key => [key, memoryStorage.get(key) ?? null]);
  },
  async multiSet(pairs: [string, string][]): Promise<void> {
    pairs.forEach(([key, value]) => memoryStorage.set(key, value));
  },
};

/**
 * Current storage adapter. Defaults to in-memory, but should be set
 * by the mobile app to use AsyncStorage.
 */
let storageAdapter: TourStorageAdapter = inMemoryStorageAdapter;

/**
 * Set the storage adapter for tour persistence.
 * Call this early in app initialization with your platform-specific storage.
 *
 * @example Mobile (with AsyncStorage):
 * ```ts
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * setTourStorageAdapter(AsyncStorage);
 * ```
 */
export function setTourStorageAdapter(adapter: TourStorageAdapter): void {
  storageAdapter = adapter;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const STORAGE_PREFIX = 'rallia_tour_';

// =============================================================================
// SERVICE
// =============================================================================

/**
 * Tour Service for managing tour completion persistence
 */
export const tourService = {
  /**
   * Check if a specific tour has been completed
   */
  async isTourCompleted(tourId: TourId): Promise<boolean> {
    try {
      const value = await storageAdapter.getItem(`${STORAGE_PREFIX}${tourId}`);
      return value === 'true';
    } catch (error) {
      Logger.error('Failed to check tour completion status', error as Error, { tourId });
      return false;
    }
  },

  /**
   * Mark a tour as completed or not completed
   */
  async setTourCompleted(tourId: TourId, completed: boolean): Promise<void> {
    try {
      await storageAdapter.setItem(`${STORAGE_PREFIX}${tourId}`, completed ? 'true' : 'false');
      Logger.debug(`Tour ${tourId} marked as ${completed ? 'completed' : 'not completed'}`);
    } catch (error) {
      Logger.error('Failed to set tour completion status', error as Error, { tourId, completed });
      throw error;
    }
  },

  /**
   * Get the completion status of all tours
   */
  async getAllTourStatus(): Promise<TourStatus> {
    try {
      const tourIds: TourId[] = [
        'welcome',
        'main_navigation',
        'home_screen',
        'matches_screen',
        'create_match',
        'chat_screen',
        'profile_screen',
        'notifications_screen',
      ];

      const keys = tourIds.map(id => `${STORAGE_PREFIX}${id}`);
      const results = await storageAdapter.multiGet(keys);

      const status: TourStatus = {};
      results.forEach(([_key, value], index) => {
        const tourId = tourIds[index];
        status[tourId] = value === 'true';
      });

      return status;
    } catch (error) {
      Logger.error('Failed to get all tour status', error as Error);
      return {};
    }
  },

  /**
   * Reset all tours (mark all as not completed)
   */
  async resetAllTours(): Promise<void> {
    try {
      const tourIds: TourId[] = [
        'welcome',
        'main_navigation',
        'home_screen',
        'matches_screen',
        'create_match',
        'chat_screen',
        'profile_screen',
        'notifications_screen',
      ];

      const pairs: [string, string][] = tourIds.map(id => [`${STORAGE_PREFIX}${id}`, 'false']);

      await storageAdapter.multiSet(pairs);
      Logger.debug('All tours reset');
    } catch (error) {
      Logger.error('Failed to reset all tours', error as Error);
      throw error;
    }
  },

  /**
   * Check if this is the user's first time (no tours completed)
   */
  async isFirstTimeUser(): Promise<boolean> {
    try {
      const status = await this.getAllTourStatus();
      return !Object.values(status).some(completed => completed === true);
    } catch (error) {
      Logger.error('Failed to check first time user status', error as Error);
      return true; // Assume first time if we can't check
    }
  },

  /**
   * Get the next tour that should be shown (first uncompleted tour in sequence)
   */
  async getNextPendingTour(): Promise<TourId | null> {
    try {
      const tourSequence: TourId[] = [
        'welcome',
        'main_navigation',
        'home_screen',
        'matches_screen',
        'create_match',
        'chat_screen',
        'profile_screen',
        'notifications_screen',
      ];

      const status = await this.getAllTourStatus();

      for (const tourId of tourSequence) {
        if (!status[tourId]) {
          return tourId;
        }
      }

      return null; // All tours completed
    } catch (error) {
      Logger.error('Failed to get next pending tour', error as Error);
      return null;
    }
  },
};

export default tourService;
