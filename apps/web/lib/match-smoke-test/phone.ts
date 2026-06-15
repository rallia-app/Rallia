const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** Normalize a 10-digit NA local number to E.164 (+1…). */
export function toE164NorthAmerica(digits: string): string | null {
  const cleaned = digits.replace(/\D/g, '');
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return null;
}

export function isValidE164Phone(phone: string): boolean {
  return E164_REGEX.test(phone.replace(/[\s\-()]/g, ''));
}

export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
