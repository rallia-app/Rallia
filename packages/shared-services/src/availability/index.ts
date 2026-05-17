/**
 * Availability Services
 *
 * Exports for court availability fetching via external providers.
 */

// Types
export * from './types';

// Parser utilities (legacy, still used for fallback parsing)
export {
  parseAvailability,
  getNextAvailableSlots,
  isToday,
  formatSlotTime,
  type ParsedAvailability,
} from './availabilityParser';

// Provider system
export * from './providers';

// Availability service
export {
  fetchProviderConfig,
  clearProviderCache,
  fetchAvailability,
  fetchTodayAvailability,
  filterFutureSlots,
  getNextSlots,
  // Unified availability (local-first)
  fetchUnifiedAvailability,
  type UnifiedAvailabilityParams,
} from './availabilityService';

// Local availability fetcher
export {
  hasLocalTemplates,
  fetchLocalAvailability,
  clearLocalTemplatesCache,
} from './localAvailabilityFetcher';
