/**
 * E.164 phone validation shared across functions.
 */
export function isValidPhoneNumber(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone.replace(/[\s\-()]/g, ''));
}

export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[\s\-()]/g, '');
}
