/**
 * Storage Adapter for shared-hooks
 *
 * This module provides a platform-agnostic storage interface.
 * Mobile apps should call setHooksStorageAdapter with AsyncStorage.
 * Web apps can use localStorage or the default in-memory adapter.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Storage adapter interface compatible with AsyncStorage and localStorage.
 */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
  multiGet?(keys: readonly string[]): Promise<ReadonlyArray<[string, string | null]>>;
  multiSet?(pairs: ReadonlyArray<[string, string]>): Promise<void>;
}

// =============================================================================
// IN-MEMORY STORAGE (Default fallback)
// =============================================================================

const memoryStorage: Map<string, string> = new Map();

/**
 * In-memory storage adapter for web or testing.
 * Data is lost when the page is refreshed.
 */
export const inMemoryStorageAdapter: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    return memoryStorage.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    memoryStorage.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    memoryStorage.delete(key);
  },
  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    return keys.map(key => [key, memoryStorage.get(key) ?? null]);
  },
  async multiSet(pairs: [string, string][]): Promise<void> {
    pairs.forEach(([key, value]) => memoryStorage.set(key, value));
  },
};

// =============================================================================
// LOCALSTORAGE ADAPTER (For web)
// =============================================================================

/**
 * localStorage adapter for web apps.
 * Only usable in browser environments.
 */
export const localStorageAdapter: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  },
  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    if (typeof localStorage === 'undefined') {
      return keys.map(key => [key, null]);
    }
    return keys.map(key => [key, localStorage.getItem(key)]);
  },
  async multiSet(pairs: [string, string][]): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    pairs.forEach(([key, value]) => localStorage.setItem(key, value));
  },
};

// =============================================================================
// GLOBAL ADAPTER
// =============================================================================

/**
 * Current storage adapter.
 * Defaults to localStorage for browser, in-memory for Node.js.
 */
let storageAdapter: StorageAdapter =
  typeof localStorage !== 'undefined' ? localStorageAdapter : inMemoryStorageAdapter;

/**
 * Set the storage adapter for all shared hooks.
 * Call this early in app initialization with your platform-specific storage.
 *
 * @example Mobile (with AsyncStorage):
 * ```ts
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { setHooksStorageAdapter } from '@rallia/shared-hooks';
 *
 * setHooksStorageAdapter(AsyncStorage);
 * ```
 *
 * @example Web (with localStorage - default):
 * ```ts
 * // localStorage is used by default in browser, no need to call this
 * ```
 */
export function setHooksStorageAdapter(adapter: StorageAdapter): void {
  storageAdapter = adapter;
}

/**
 * Get the current storage adapter.
 */
export function getStorageAdapter(): StorageAdapter {
  return storageAdapter;
}
