/**
 * Geo Utilities
 * Functions for geographic calculations and coverage zones
 */

export {
  isValidCanadianPostalCode,
  isValidUSZipCode,
  detectPostalCodeCountry,
  normalizePostalCode,
  formatPostalCodeInput,
} from './coverageZones';

/**
 * Earth's radius in meters
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate the distance in meters between two geographic coordinates
 * using the Haversine formula.
 *
 * The Haversine formula determines the great-circle distance between
 * two points on a sphere given their longitudes and latitudes.
 *
 * @param lat1 - Latitude of point 1 in degrees
 * @param lon1 - Longitude of point 1 in degrees
 * @param lat2 - Latitude of point 2 in degrees
 * @param lon2 - Longitude of point 2 in degrees
 * @returns Distance in meters between the two points
 *
 * @example
 * // Calculate distance between two points
 * const distance = calculateDistanceMeters(45.5017, -73.5673, 45.5088, -73.5878);
 * console.log(distance); // ~1750 meters
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Check if a point is within a specified radius of another point.
 *
 * @param lat1 - Latitude of point 1 (center) in degrees
 * @param lon1 - Longitude of point 1 (center) in degrees
 * @param lat2 - Latitude of point 2 (to check) in degrees
 * @param lon2 - Longitude of point 2 (to check) in degrees
 * @param radiusMeters - Radius in meters
 * @returns true if point 2 is within the radius of point 1
 *
 * @example
 * // Check if user is within 100m of a location
 * const isNearby = isWithinRadius(45.5017, -73.5673, 45.5018, -73.5674, 100);
 */
export function isWithinRadius(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radiusMeters: number
): boolean {
  const distance = calculateDistanceMeters(lat1, lon1, lat2, lon2);
  return distance <= radiusMeters;
}
