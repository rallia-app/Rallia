/**
 * Vendored so this app ships no workspace dependencies.
 * Sources: packages/shared-utils/src/validators/inputValidators.ts and
 * packages/shared-utils/src/geo/coverageZones.ts.
 */

/** Strips to digits and caps at 10. */
export function validatePhoneNumber(text: string): string {
  return text.replace(/[^0-9]/g, '').slice(0, 10);
}

export function validateEmail(email: string): boolean {
  // Excluding `.` from the middle character class eliminates the overlap between
  // the two `[^\s@]+` runs around `\.`, which is polynomial-ReDoS-prone.
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email);
}

const CA_POSTAL_REGEX = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;
const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;

/**
 * Returns null when the input isn't a postal code, so this doubles as the
 * detector that decides whether step 2 geocodes directly or runs autocomplete.
 */
export function normalizePostalCode(
  postalCode: string
): { normalized: string; country: 'CA' | 'US' } | null {
  const trimmed = postalCode.trim();

  if (CA_POSTAL_REGEX.test(trimmed)) {
    const cleaned = trimmed.replace(/[\s-]/g, '').toUpperCase();
    return { normalized: `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`, country: 'CA' };
  }

  if (US_ZIP_REGEX.test(trimmed)) {
    return { normalized: trimmed, country: 'US' };
  }

  return null;
}
