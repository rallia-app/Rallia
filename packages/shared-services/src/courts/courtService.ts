/**
 * Court Service
 * Handles court-related database operations using Supabase.
 * Supports court lookup and creation from external provider data.
 */

import { supabase } from '../supabase';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Data required to create a court from external provider information
 */
export interface ExternalCourtData {
  /** Local facility ID (UUID) */
  facilityId: string;
  /** External provider court ID (e.g., Montreal's facility.id like "172601") */
  externalProviderId: string;
  /** Court name from the external provider (e.g., "Tennis Court 1") */
  courtName: string;
}

/**
 * Minimal court record returned from lookups
 */
export interface CourtRecord {
  id: string;
  name: string | null;
  court_number: number | null;
  facility_id: string;
  external_provider_id: string | null;
}

/**
 * Result of a court lookup/create operation
 */
export interface GetOrCreateCourtResult {
  /** The local court record */
  court: CourtRecord;
  /** Whether the court was newly created */
  created: boolean;
  /** Whether an existing court was updated with external provider data */
  updated: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract court number from a court name string.
 *
 * The Montreal API returns court names in various formats:
 * - "Tennis Court 1" → 1
 * - "Court 3" → 3
 * - "Terrain de tennis 2" → 2
 * - "Tennis 4" → 4
 *
 * @param courtName - The court name from the external provider
 * @returns The extracted court number, or null if no number found
 *
 * @example
 * parseCourtNumber("Tennis Court 1") // → 1
 * parseCourtNumber("Court 3") // → 3
 * parseCourtNumber("Some Court") // → null
 */
export function parseCourtNumber(courtName: string): number | null {
  if (!courtName) return null;

  // Number at the end of the string (most common: "Tennis Court 1", "Court 3").
  // Scanned manually from the end (after trimming) to avoid polynomial backtracking.
  const trimmed = courtName.trimEnd();
  let start = trimmed.length;
  while (start > 0) {
    const code = trimmed.charCodeAt(start - 1);
    if (code < 48 || code > 57) break;
    start--;
  }
  if (start < trimmed.length) {
    return parseInt(trimmed.slice(start), 10);
  }

  // Fallback: look for any number in the string
  const anyMatch = courtName.match(/(\d+)/);
  if (anyMatch) {
    return parseInt(anyMatch[1], 10);
  }

  return null;
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Get a court by its external provider ID within a specific facility.
 *
 * @param facilityId - Local facility UUID
 * @param externalProviderId - External provider's court ID
 * @returns The court record if found, null otherwise
 */
export async function getCourtByExternalId(
  facilityId: string,
  externalProviderId: string
): Promise<CourtRecord | null> {
  const { data, error } = await supabase
    .from('court')
    .select('id, name, court_number, facility_id, external_provider_id')
    .eq('facility_id', facilityId)
    .eq('external_provider_id', externalProviderId)
    .single();

  if (error) {
    // PGRST116 = no rows returned - not an error, just not found
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get court: ${error.message}`);
  }

  return data;
}

/**
 * Get a court by its court number within a specific facility.
 *
 * @param facilityId - Local facility UUID
 * @param courtNumber - The court number (e.g., 1, 2, 3)
 * @returns The court record if found, null otherwise
 */
export async function getCourtByNumber(
  facilityId: string,
  courtNumber: number
): Promise<CourtRecord | null> {
  const { data, error } = await supabase
    .from('court')
    .select('id, name, court_number, facility_id, external_provider_id')
    .eq('facility_id', facilityId)
    .eq('court_number', courtNumber)
    .limit(1)
    .maybeSingle();

  if (error) {
    // PGRST116 = no rows returned - not an error, just not found
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get court by number: ${error.message}`);
  }

  return data;
}

/**
 * Update an existing court with external provider data.
 *
 * This is used when we find an existing court by court number that doesn't
 * have an external_provider_id yet. We update it with the data from the API.
 *
 * @param courtId - Local court UUID to update
 * @param externalData - External provider data to apply
 * @returns The updated court record
 */
export async function updateCourtWithExternalData(
  courtId: string,
  externalData: { externalProviderId: string; courtName: string }
): Promise<CourtRecord> {
  const { externalProviderId, courtName } = externalData;

  const { data, error } = await supabase
    .from('court')
    .update({
      external_provider_id: externalProviderId,
      // Only update name if we have one from the API
      ...(courtName && { name: courtName }),
    })
    .eq('id', courtId)
    .select('id, name, court_number, facility_id, external_provider_id')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update court: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Court not found after update: ${courtId}`);
  }

  return data;
}

/**
 * Create a new court record from external provider data.
 *
 * This creates a minimal court record with the external provider mapping.
 * Additional court details (surface type, lights, etc.) can be updated later.
 *
 * @param courtData - External court data including facility ID, external ID, and name
 * @returns The newly created court record
 */
export async function createCourtFromExternal(courtData: ExternalCourtData): Promise<CourtRecord> {
  const { facilityId, externalProviderId, courtName } = courtData;

  // Extract court number from the name (e.g., "Tennis Court 1" → 1)
  const courtNumber = parseCourtNumber(courtName);

  const { data, error } = await supabase
    .from('court')
    .insert({
      facility_id: facilityId,
      external_provider_id: externalProviderId,
      name: courtName,
      court_number: courtNumber,
      // Set reasonable defaults for required fields
      availability_status: 'available' as const,
      is_active: true,
      indoor: false, // Most Montreal courts are outdoor
      lighting: false, // Unknown, can be updated later
      lines_marked_for_multiple_sports: false,
    })
    .select('id, name, court_number, facility_id, external_provider_id')
    .single();

  if (error) {
    throw new Error(`Failed to create court: ${error.message}`);
  }

  return data;
}

/**
 * Get an existing court by external ID, or create/update one if it doesn't exist.
 *
 * This is the main function to use when a user confirms a booking from an external
 * provider. It ensures we have a local court record to link to the match.
 *
 * Lookup strategy:
 * 1. First, try to find by external_provider_id (exact match from previous bookings)
 * 2. If not found and we can parse a court number, try to find by court_number
 *    - If found, update the existing court with the external_provider_id
 * 3. If still not found, create a new court
 *
 * @param courtData - External court data
 * @returns The court record (existing, updated, or newly created) and status flags
 *
 * @example
 * ```ts
 * const { court, created, updated } = await getOrCreateCourt({
 *   facilityId: 'abc-123',
 *   externalProviderId: '172601',
 *   courtName: 'Tennis Court 1',
 * });
 *
 * // Use court.id to link to the match
 * setValue('courtId', court.id);
 * ```
 */
export async function getOrCreateCourt(
  courtData: ExternalCourtData
): Promise<GetOrCreateCourtResult> {
  const { facilityId, externalProviderId, courtName } = courtData;

  // 1. First, try to find an existing court with this external ID
  const courtByExternalId = await getCourtByExternalId(facilityId, externalProviderId);

  if (courtByExternalId) {
    return {
      court: courtByExternalId,
      created: false,
      updated: false,
    };
  }

  // 2. Try to find by court number (for courts that were created before API integration)
  const courtNumber = parseCourtNumber(courtName);

  if (courtNumber !== null) {
    const courtByNumber = await getCourtByNumber(facilityId, courtNumber);

    if (courtByNumber) {
      // Found a court with matching number - try to update it with external provider data
      try {
        const updatedCourt = await updateCourtWithExternalData(courtByNumber.id, {
          externalProviderId,
          courtName,
        });

        return {
          court: updatedCourt,
          created: false,
          updated: true,
        };
      } catch {
        // Update may fail due to RLS policies — return the existing court as-is
        return {
          court: courtByNumber,
          created: false,
          updated: false,
        };
      }
    }
  }

  // 3. No existing court found - create a new one
  const newCourt = await createCourtFromExternal({
    facilityId,
    externalProviderId,
    courtName,
  });

  return {
    court: newCourt,
    created: true,
    updated: false,
  };
}

/**
 * Get a court by its local ID.
 *
 * @param courtId - Local court UUID
 * @returns The court record if found, null otherwise
 */
export async function getCourtById(courtId: string): Promise<CourtRecord | null> {
  const { data, error } = await supabase
    .from('court')
    .select('id, name, court_number, facility_id, external_provider_id')
    .eq('id', courtId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get court: ${error.message}`);
  }

  return data;
}

// =============================================================================
// SERVICE EXPORT
// =============================================================================

/**
 * Court service object for grouped exports
 */
export const courtService = {
  parseCourtNumber,
  getCourtByExternalId,
  getCourtByNumber,
  updateCourtWithExternalData,
  createCourtFromExternal,
  getOrCreateCourt,
  getCourtById,
};

export default courtService;
