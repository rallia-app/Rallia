/**
 * Input Validation Utilities
 *
 * Reusable validation functions for form inputs
 */

/**
 * Validates and filters full name input
 * Only allows letters and spaces
 *
 * @param text - The input text to validate
 * @returns Validated text with only letters and spaces
 *
 * @example
 * validateFullName("John123 Doe!") // Returns "John Doe"
 */
export const validateFullName = (text: string): string => {
  // Only allow letters and spaces
  return text.replace(/[^a-zA-Z\s]/g, '');
};

/**
 * Validates and filters username input
 * Removes spaces and limits to 10 characters
 *
 * @param text - The input text to validate
 * @returns Validated text without spaces, max 10 characters
 *
 * @example
 * validateUsername("john doe123") // Returns "johndoe123"
 * validateUsername("verylongusername") // Returns "verylong"
 */
export const validateUsername = (text: string): string => {
  // Remove spaces and limit to 10 characters
  return text.replace(/\s/g, '').slice(0, 10);
};

/**
 * Validates and filters phone number input
 * Only allows numbers and limits to 10 digits
 *
 * @param text - The input text to validate
 * @returns Validated text with only numbers, max 10 digits
 *
 * @example
 * validatePhoneNumber("(514) 123-4567") // Returns "5141234567"
 * validatePhoneNumber("12345678901") // Returns "1234567890"
 */
export const validatePhoneNumber = (text: string): string => {
  // Only allow numbers and limit to 10 digits
  return text.replace(/[^0-9]/g, '').slice(0, 10);
};

/**
 * Validates email format
 *
 * @param email - The email to validate
 * @returns True if email format is valid
 *
 * @example
 * validateEmail("user@example.com") // Returns true
 * validateEmail("invalid-email") // Returns false
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates password strength
 * Password must be at least 8 characters with at least one letter and one number
 *
 * @param password - The password to validate
 * @returns True if password meets requirements
 *
 * @example
 * validatePassword("Pass123") // Returns false (too short)
 * validatePassword("Password123") // Returns true
 */
export const validatePassword = (password: string): boolean => {
  const minLength = 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  return password.length >= minLength && hasLetter && hasNumber;
};

/**
 * Referral / invite code format (matches server-side generation):
 * - Exactly 8 characters
 * - Crockford-style alphabet: ABCDEFGHJKLMNPQRSTUVWXYZ23456789
 *   (excludes the visually ambiguous I, O, 0, 1)
 */
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_CODE_DISALLOWED = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

/**
 * Strips disallowed characters, uppercases, and truncates to the expected length.
 * Use as the onChangeText sanitizer for a referral / invite code input.
 */
export const sanitizeReferralCode = (text: string): string => {
  return text.toUpperCase().replace(REFERRAL_CODE_DISALLOWED, '').slice(0, REFERRAL_CODE_LENGTH);
};

/**
 * Returns true when the code is exactly 8 chars from the allowed charset.
 */
export const isReferralCodeComplete = (code: string): boolean => {
  return code.length === REFERRAL_CODE_LENGTH && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/.test(code);
};
