/**
 * Name Validators
 *
 * Additional validation utilities for name inputs
 */

/**
 * Check if full name is valid (min 2 chars, letters and spaces only)
 */
export const isValidFullName = (name: string): boolean => {
  if (!name || name.trim().length === 0) {
    return false;
  }

  // Must contain at least 2 characters
  if (name.trim().length < 2) {
    return false;
  }

  // Only letters and spaces allowed
  const nameRegex = /^[a-zA-Z\s]+$/;
  return nameRegex.test(name);
};

/**
 * Sanitize name input (remove non-letter/space characters)
 * Same as validateFullName from inputValidators, provided as alias
 */
export const sanitizeName = (name: string): string => {
  return name.replace(/[^a-zA-Z\s]/g, '');
};

/**
 * Validate first/last name separately
 */
export const isValidName = (name: string): boolean => {
  if (!name || name.trim().length === 0) {
    return false;
  }

  // Must be at least 1 character
  if (name.trim().length < 1) {
    return false;
  }

  // Only letters allowed
  const nameRegex = /^[a-zA-Z]+$/;
  return nameRegex.test(name.trim());
};

/**
 * Check if name has at least first and last name
 */
export const hasFirstAndLastName = (fullName: string): boolean => {
  const parts = fullName.trim().split(/\s+/);
  return parts.length >= 2 && parts.every(part => part.length > 0);
};
