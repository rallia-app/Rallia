/**
 * Postal code format utilities.
 * Validates and normalizes Canadian and US postal codes.
 *
 * Note: Coverage zone validation (is the postal code in a served area?)
 * is now handled dynamically by the check_postal_code_coverage Supabase RPC,
 * which checks proximity to facilities with court availability.
 */

// Canadian postal code format: A1A 1A1 (letter-digit-letter digit-letter-digit)
// First letter: A-Z except D, F, I, O, Q, U, W, Z
// See: https://en.wikipedia.org/wiki/Postal_codes_in_Canada
const CA_POSTAL_REGEX = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

// US ZIP code: 12345 or 12345-6789
const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;

/**
 * Validates Canadian postal code format (A1A 1A1) using regex.
 * Does not validate that the postal code exists, only format.
 */
export function isValidCanadianPostalCode(postalCode: string): boolean {
  const trimmed = postalCode.trim();
  return CA_POSTAL_REGEX.test(trimmed);
}

/**
 * Validates US ZIP code format (12345 or 12345-6789).
 */
export function isValidUSZipCode(postalCode: string): boolean {
  const trimmed = postalCode.trim();
  return US_ZIP_REGEX.test(trimmed);
}

/**
 * Detect the country of a postal code based on format, or null if unrecognized.
 */
export function detectPostalCodeCountry(postalCode: string): 'CA' | 'US' | null {
  const trimmed = postalCode.trim();
  if (CA_POSTAL_REGEX.test(trimmed)) return 'CA';
  if (US_ZIP_REGEX.test(trimmed)) return 'US';
  return null;
}

/**
 * Normalize a postal code to its canonical display form.
 * - Canadian: "H2X 1Y4" (uppercase, space in middle)
 * - US: "90210" or "90210-1234" (trimmed)
 * Returns null if format is invalid.
 */
export function normalizePostalCode(
  postalCode: string
): { normalized: string; country: 'CA' | 'US' } | null {
  const trimmed = postalCode.trim();

  if (CA_POSTAL_REGEX.test(trimmed)) {
    const cleaned = trimmed.replace(/[\s-]/g, '').toUpperCase();
    return {
      normalized: `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`,
      country: 'CA',
    };
  }

  if (US_ZIP_REGEX.test(trimmed)) {
    return { normalized: trimmed, country: 'US' };
  }

  return null;
}

/**
 * Format raw input into LDL DLD (Canadian postal code) pattern as the user types.
 * Filters characters to enforce strict alternating Letter-Digit-Letter Digit-Letter-Digit.
 * Returns the formatted string with auto-inserted space (e.g. "H2X 1Y4").
 */
export function formatPostalCodeInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

  let filtered = '';
  for (let i = 0; i < cleaned.length && i < 6; i++) {
    const ch = cleaned[i];
    const isLetter = /[A-Z]/.test(ch);
    const isDigit = /[0-9]/.test(ch);
    // Positions 0,2,4 must be letters; positions 1,3,5 must be digits
    if ((i % 2 === 0 && isLetter) || (i % 2 === 1 && isDigit)) {
      filtered += ch;
    } else {
      break;
    }
  }

  return filtered.length > 3 ? `${filtered.slice(0, 3)} ${filtered.slice(3)}` : filtered;
}
