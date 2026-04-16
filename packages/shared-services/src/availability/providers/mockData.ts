/**
 * Mock Data for IC3/Otium Provider
 *
 * Generates realistic mock API responses for testing during winter
 * when no real tennis court availability exists.
 */

import type { IC3SearchResponse, IC3Slot } from '../types';

// =============================================================================
// MOCK FACILITIES DATA
// =============================================================================

const MOCK_SITES = [
  {
    id: 1726,
    name: 'Parc Jeanne-Mance, terrains sportifs',
    address: "4260 Avenue de l'Esplanade, Montréal, QC H2W 1T1",
    boroughId: 2,
    boroughName: 'Le Plateau-Mont-Royal',
  },
  {
    id: 1734,
    name: 'Parc La Fontaine, terrains sportifs',
    address: '3933 Avenue du Parc La Fontaine, Montréal, QC H2L 3M6',
    boroughId: 2,
    boroughName: 'Le Plateau-Mont-Royal',
  },
  {
    id: 653,
    name: 'Terrains de tennis Garneau (4)',
    address: '1050 Rue Garneau, Montréal, QC H4C 1N3',
    boroughId: 4,
    boroughName: 'Le Sud-Ouest',
  },
  {
    id: 654,
    name: 'Terrains de tennis Saint-Viateur (6)',
    address: '7375 Avenue Christophe-Colomb, Montréal, QC H2R 2S5',
    boroughId: 1,
    boroughName: 'Villeray–Saint-Michel–Parc-Extension',
  },
  {
    id: 682,
    name: 'Terrains de tennis Joyce (3)',
    address: '2100 Rue Notre-Dame Ouest, Montréal, QC H3J 1M8',
    boroughId: 4,
    boroughName: 'Le Sud-Ouest',
  },
  {
    id: 882,
    name: 'Centre de Tennis Cavelier',
    address: '7500 Boulevard Maurice-Duplessis, Montréal, QC H1E 1K3',
    boroughId: 5,
    boroughName: 'Rivière-des-Prairies–Pointe-aux-Trembles',
  },
];

// Court names - each index maps to a unique court number
// Matches real API naming convention (e.g., "Tennis Court 1")
const COURT_NAMES = [
  'Tennis Court 1',
  'Tennis Court 2',
  'Tennis Court 3',
  'Tennis Court 4',
  'Tennis Court 5',
  'Tennis Court 6',
];

// Time slots available for booking (hour start times)
const AVAILABLE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

// =============================================================================
// MOCK DATA GENERATOR
// =============================================================================

let idCounter = 1;

/**
 * Generate a unique $id for mock objects.
 */
function generateId(): string {
  return String(idCounter++);
}

/**
 * Reset the ID counter (useful for deterministic testing).
 */
export function resetMockIdCounter(): void {
  idCounter = 1;
}

/**
 * Parse a date string and extract the date portion.
 * Handles both "YYYY-MM-DD" and ISO datetime formats.
 */
function extractDateString(dateInput: string): string {
  // If already in YYYY-MM-DD format, use as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }
  // Otherwise extract date from ISO string
  return dateInput.split('T')[0];
}

/**
 * Generate a single mock slot matching the Loisir Montreal API format.
 */
function generateMockSlot(
  siteIndex: number,
  courtIndex: number,
  dateStr: string,
  hour: number
): IC3Slot {
  const site = MOCK_SITES[siteIndex % MOCK_SITES.length];
  const courtName = COURT_NAMES[courtIndex % COURT_NAMES.length];

  // Generate facility ID based on site and court
  const facilityId = site.id * 100 + courtIndex + 1;
  const facilityScheduleId = parseInt(`${site.id}${hour}${courtIndex}`, 10);

  // Format datetime in Montreal timezone (Eastern Time)
  // Winter: -05:00, Summer: -04:00
  const startDateTime = `${dateStr}T${String(hour).padStart(2, '0')}:00:00.000-05:00`;
  const endDateTime = `${dateStr}T${String(hour + 1).padStart(2, '0')}:00:00.000-05:00`;

  return {
    $id: generateId(),
    facility: {
      $id: generateId(),
      id: facilityId,
      name: courtName,
      isMembershipRequired: false,
      site: {
        $id: generateId(),
        id: site.id,
        name: site.name,
        address: site.address,
        publicPhone: null,
        fax: null,
        boroughs: [
          {
            $id: generateId(),
            id: site.boroughId,
            name: site.boroughName,
            externalId: null,
          },
        ],
      },
      facilityType: {
        $id: generateId(),
        id: 1,
        name: 'Tennis',
        description: 'Outdoor Tennis Court',
      },
    },
    startDateTime,
    endDateTime,
    priorNoticeDelayInMinutes: 60,
    facilityScheduleId,
    totalPrice: 0, // Public courts are typically free
    canReserve: {
      $id: generateId(),
      value: true,
      validationResult: {
        entityType: null,
        extraParameter: null,
        parameters: [],
        dateTimeParameters: [],
        resultType: 'Success',
        rule: 'None',
        warning: false,
      },
    },
    facilityPricingId: 1,
  };
}

/**
 * Generate mock Loisir Montreal API response for the given dates.
 *
 * This creates realistic availability data matching the exact structure
 * returned by the real Loisir Montreal API.
 *
 * @param dates - Array of date strings (YYYY-MM-DD or ISO format)
 * @param siteId - Optional site ID to filter results (matches real API behavior)
 * @returns Mock API response with availability slots
 */
export function generateMockLoisirMontrealResponse(
  dates: string[],
  siteId?: number | null
): IC3SearchResponse {
  // Reset counter for consistent mock data
  resetMockIdCounter();

  const results: IC3Slot[] = [];

  // Filter sites if siteId is provided
  // When a siteId is provided but doesn't match any mock site, return empty results
  // to avoid showing duplicate courts from multiple unrelated sites
  const sitesToUse = siteId ? MOCK_SITES.filter(s => s.id === siteId) : MOCK_SITES;

  // If siteId was provided but not found, return empty results (not all sites)
  if (siteId && sitesToUse.length === 0) {
    return {
      results: [],
      recordCount: 0,
    };
  }

  const effectiveSites = sitesToUse;

  for (const dateInput of dates) {
    const dateStr = extractDateString(dateInput);

    // Generate slots for each site
    for (let siteIdx = 0; siteIdx < effectiveSites.length; siteIdx++) {
      const site = effectiveSites[siteIdx];
      const siteIndexInMock = MOCK_SITES.indexOf(site);

      // Generate 3-4 courts per site (varies by site for realism)
      const numCourts = 3 + (siteIndexInMock % 2); // 3 or 4 courts

      for (let courtIdx = 0; courtIdx < numCourts; courtIdx++) {
        // Each court has different available hours (simulates some courts being booked)
        // Court 0: all hours, Court 1: skip every 3rd hour, Court 2: skip every 2nd hour, etc.
        const availableHours = AVAILABLE_HOURS.filter((_, idx) => {
          if (courtIdx === 0) return true; // First court available all hours
          if (courtIdx === 1) return idx % 3 !== 0; // Skip every 3rd hour
          if (courtIdx === 2) return idx % 2 === 0; // Every other hour
          return idx % 4 !== 0; // Skip every 4th hour
        });

        for (const hour of availableHours) {
          const slot = generateMockSlot(siteIndexInMock, courtIdx, dateStr, hour);
          results.push(slot);
        }
      }
    }
  }

  // Sort by startDateTime to match real API behavior
  results.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));

  return {
    results,
    recordCount: results.length,
  };
}
