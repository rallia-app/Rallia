/**
 * usePostalCodeGeocode Hook
 *
 * Validates and geocodes Canadian and US postal codes using Google Geocoding API.
 * Returns the centroid coordinates for the postal code area.
 */

import { useState, useCallback } from 'react';
import { normalizePostalCode, shouldUseApiMocks } from '@rallia/shared-utils';
import { mockGeocodePostalCode } from './devMocks/googlePlaces';

// =============================================================================
// TYPES
// =============================================================================

export interface PostalCodeLocation {
  /** Normalized postal code (uppercase, proper spacing) */
  postalCode: string;
  /** Country code */
  country: 'CA' | 'US';
  /** Human-readable formatted address from Google */
  formattedAddress: string;
  /** City or locality, when available from geocoding */
  city?: string;
  /** Province/state short code (e.g. QC, ON), when available */
  province?: string;
  /** Latitude of postal code centroid */
  latitude: number;
  /** Longitude of postal code centroid */
  longitude: number;
}

interface UsePostalCodeGeocodeReturn {
  /** Geocode a postal code and return location details */
  geocode: (postalCode: string) => Promise<PostalCodeLocation | null>;
  /** Whether a geocoding request is in progress */
  isLoading: boolean;
  /** Error message if geocoding failed */
  error: string | null;
  /** Last successful geocoding result */
  result: PostalCodeLocation | null;
  /** Clear the current result and error */
  clearResult: () => void;
  /** Validate postal code format without geocoding */
  validateFormat: (postalCode: string) => {
    isValid: boolean;
    country: 'CA' | 'US' | null;
    normalized: string | null;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const GOOGLE_GEOCODING_API_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

interface GeocodeAddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

function parseGeocodeAddressComponents(components: GeocodeAddressComponent[] | undefined): {
  city?: string;
  province?: string;
} {
  if (!components?.length) return {};

  const getComponent = (types: string[], useShort = false): string => {
    const component = components.find(c => types.some(type => c.types?.includes(type)));
    return (useShort ? component?.short_name : component?.long_name) || '';
  };

  const city =
    getComponent(['locality']) ||
    getComponent(['administrative_area_level_3']) ||
    getComponent(['sublocality_level_1']);
  const province = getComponent(['administrative_area_level_1'], true);

  return {
    ...(city && { city }),
    ...(province && { province }),
  };
}

// Get API key from environment
const getApiKey = (): string | null => {
  // For React Native (Expo)
  if (typeof process !== 'undefined' && process.env) {
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (apiKey) {
      return apiKey;
    }
  }

  // For Next.js
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY) {
    return process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  }

  return null;
};

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

export function usePostalCodeGeocode(): UsePostalCodeGeocodeReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PostalCodeLocation | null>(null);

  /**
   * Validate postal code format without making an API call.
   * Uses centralized validation from @rallia/shared-utils.
   */
  const validateFormat = useCallback(
    (
      postalCode: string
    ): { isValid: boolean; country: 'CA' | 'US' | null; normalized: string | null } => {
      const result = normalizePostalCode(postalCode);
      if (!result) {
        return { isValid: false, country: null, normalized: null };
      }
      return { isValid: true, country: result.country, normalized: result.normalized };
    },
    []
  );

  /**
   * Clear the current result and error state
   */
  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  /**
   * Geocode a postal code using Google Geocoding API
   */
  const geocode = useCallback(
    async (postalCode: string): Promise<PostalCodeLocation | null> => {
      // Validate format first (cheap, no network)
      const validation = validateFormat(postalCode);

      if (!validation.isValid || !validation.country || !validation.normalized) {
        setError('invalid');
        return null;
      }

      if (shouldUseApiMocks()) {
        setIsLoading(true);
        setError(null);
        try {
          const mocked = await mockGeocodePostalCode(validation.normalized, validation.country);
          setResult(mocked);
          return mocked;
        } finally {
          setIsLoading(false);
        }
      }

      const apiKey = getApiKey();

      if (!apiKey) {
        const errorMsg =
          'Google API key not configured. ' + 'Ensure EXPO_PUBLIC_GOOGLE_PLACES_API_KEY is set.';
        console.error(errorMsg);
        setError(errorMsg);
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Build the geocoding URL
        // Use components filter to restrict to CA or US
        const countryComponent = validation.country === 'CA' ? 'country:CA' : 'country:US';
        const url = `${GOOGLE_GEOCODING_API_URL}?address=${encodeURIComponent(validation.normalized)}&components=${countryComponent}&key=${apiKey}`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status === 'ZERO_RESULTS' || !data.results || data.results.length === 0) {
          setError('notFound');
          setIsLoading(false);
          return null;
        }

        if (data.status !== 'OK') {
          console.error('Geocoding API error:', data.status, data.error_message);
          setError('networkError');
          setIsLoading(false);
          return null;
        }

        const firstResult = data.results[0];
        const location = firstResult.geometry?.location;
        const { city, province } = parseGeocodeAddressComponents(firstResult.address_components);

        if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
          setError('notFound');
          setIsLoading(false);
          return null;
        }

        const postalCodeLocation: PostalCodeLocation = {
          postalCode: validation.normalized,
          country: validation.country,
          formattedAddress: firstResult.formatted_address || validation.normalized,
          ...(city && { city }),
          ...(province && { province }),
          latitude: location.lat,
          longitude: location.lng,
        };

        setResult(postalCodeLocation);
        setIsLoading(false);
        return postalCodeLocation;
      } catch (err) {
        console.error('Geocoding error:', err);
        setError('networkError');
        setIsLoading(false);
        return null;
      }
    },
    [validateFormat]
  );

  return {
    geocode,
    isLoading,
    error,
    result,
    clearResult,
    validateFormat,
  };
}

export default usePostalCodeGeocode;
