/**
 * Deduplicate Match Suggestions by Day+Hour
 *
 * Ensures only one suggestion card appears per calendar hour across the feed.
 * When two suggestions collide on the same day+hour, the one with the higher
 * `playerCompatibility` score wins.
 */

import type { MatchSuggestion, AvailableTimeSlot } from '@rallia/shared-services';
import { pickSlotForSuggestion } from './useUnifiedMatchFeed';

// =============================================================================
// TYPES
// =============================================================================

export interface DeduplicatedSuggestion {
  suggestion: MatchSuggestion;
  pickedSlot: AvailableTimeSlot;
  pickedFacilityIndex: number;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Picks a slot for each suggestion, then deduplicates by day+hour.
 * When two suggestions collide on the same calendar hour, the one with
 * the higher `playerCompatibility` score wins.
 *
 * @param suggestions - Array of suggestions, expected to be pre-sorted by score desc
 * @param nowMs - Current timestamp in milliseconds (for future-slot filtering)
 * @returns Deduplicated array preserving original score order
 */
export function deduplicateSuggestionsByTimeSlot(
  suggestions: MatchSuggestion[],
  nowMs: number
): DeduplicatedSuggestion[] {
  // Map: "YYYY-MM-DD HH" -> best candidate seen so far
  const slotMap = new Map<string, DeduplicatedSuggestion>();
  const results: DeduplicatedSuggestion[] = [];

  for (const suggestion of suggestions) {
    const picked = pickSlotForSuggestion(suggestion, nowMs);
    if (!picked) continue;

    const slotDate =
      picked.slot.datetime instanceof Date ? picked.slot.datetime : new Date(picked.slot.datetime);

    // Key at hour granularity: "2025-05-04 15"
    const dayHourKey = `${slotDate.getFullYear()}-${String(slotDate.getMonth() + 1).padStart(2, '0')}-${String(slotDate.getDate()).padStart(2, '0')} ${String(slotDate.getHours()).padStart(2, '0')}`;

    const existing = slotMap.get(dayHourKey);
    if (!existing) {
      const entry: DeduplicatedSuggestion = {
        suggestion,
        pickedSlot: picked.slot,
        pickedFacilityIndex: picked.facilityIndex,
      };
      slotMap.set(dayHourKey, entry);
      results.push(entry);
    } else if (suggestion.playerCompatibility > existing.suggestion.playerCompatibility) {
      // Replace the existing lower-scored suggestion
      const idx = results.indexOf(existing);
      const entry: DeduplicatedSuggestion = {
        suggestion,
        pickedSlot: picked.slot,
        pickedFacilityIndex: picked.facilityIndex,
      };
      results[idx] = entry;
      slotMap.set(dayHourKey, entry);
    }
    // else: lower or equal score on same slot, discard
  }

  return results;
}
