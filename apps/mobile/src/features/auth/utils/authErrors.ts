/**
 * Authentication Error Utilities
 *
 * Maps technical error codes and messages to user-friendly strings.
 * Ensures users see helpful messages instead of cryptic technical errors.
 */

/**
 * Known error patterns and their user-friendly messages
 */
const ERROR_MESSAGES: Record<string, string> = {
  // Supabase Auth Errors
  'Invalid login credentials': 'Invalid email or password. Please try again.',
  'Email not confirmed': 'Please verify your email address before signing in.',
  'User not found': 'No account found with this email address.',
  'Invalid OTP': 'The verification code is incorrect. Please try again.',
  'Token has expired': 'The verification code has expired. Please request a new one.',
  'Email rate limit exceeded': 'Too many attempts. Please wait a few minutes before trying again.',
  over_email_send_rate_limit:
    'Too many verification emails sent. Please wait before requesting another.',
  otp_expired: 'The verification code has expired. Please request a new one.',
  otp_disabled: 'Email verification is currently unavailable. Please try again later.',

  // Google Sign-In Errors
  SIGN_IN_CANCELLED: 'Sign-in was cancelled.',
  IN_PROGRESS: 'A sign-in is already in progress.',
  PLAY_SERVICES_NOT_AVAILABLE: 'Google Play Services is required. Please update it and try again.',
  DEVELOPER_ERROR: 'Configuration error. Please contact support.',
  'Unacceptable audience':
    'Authentication configuration error. Please try again or contact support.',

  // Apple Sign-In Errors
  ERR_REQUEST_CANCELED: 'Sign-in was cancelled.',
  ERR_REQUEST_FAILED: 'Apple Sign-In failed. Please try again.',
  ERR_REQUEST_NOT_HANDLED: 'Apple Sign-In is not available on this device.',
  ERR_REQUEST_UNKNOWN: 'An unknown error occurred with Apple Sign-In.',

  // Account Status Errors
  ACCOUNT_SUSPENDED:
    'Your account has been suspended. Please contact support for more information.',

  // Network Errors
  'Network request failed': 'Unable to connect. Please check your internet connection.',
  'Failed to fetch': 'Unable to connect. Please check your internet connection.',
  NetworkError: 'Unable to connect. Please check your internet connection.',
  timeout: 'The request timed out. Please try again.',

  // Generic Supabase Errors
  AuthApiError: 'Authentication failed. Please try again.',
  AuthRetryableFetchError: 'Connection issue. Please check your internet and try again.',
  AuthSessionMissingError: 'Your session has expired. Please sign in again.',

  // ID Token Errors (from OAuth)
  'No ID token received': 'Sign-in failed. Please try again.',
  'No identity token received': 'Sign-in failed. Please try again.',
  'No user returned': 'Sign-in failed. Please try again.',
};

/**
 * Default fallback message for unknown errors
 */
const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Convert a technical error to a user-friendly message
 *
 * @param error - The error object, message string, or error code
 * @returns A user-friendly error message
 */
export function getFriendlyErrorMessage(error: unknown): string {
  if (!error) {
    return DEFAULT_ERROR_MESSAGE;
  }

  // Extract error message string
  let errorMessage: string;

  if (typeof error === 'string') {
    errorMessage = error;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'object' && error !== null) {
    // Handle Supabase error objects
    const errorObj = error as { message?: string; code?: string; error_description?: string };
    errorMessage = errorObj.message || errorObj.error_description || errorObj.code || '';
  } else {
    return DEFAULT_ERROR_MESSAGE;
  }

  // Check for exact matches first
  if (ERROR_MESSAGES[errorMessage]) {
    return ERROR_MESSAGES[errorMessage];
  }

  // Check for partial matches (error message contains known pattern)
  for (const [pattern, friendlyMessage] of Object.entries(ERROR_MESSAGES)) {
    if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return friendlyMessage;
    }
  }

  // Check for error codes in the message (e.g., "[AuthApiError: ...]")
  for (const [pattern, friendlyMessage] of Object.entries(ERROR_MESSAGES)) {
    if (errorMessage.includes(`[${pattern}`)) {
      return friendlyMessage;
    }
  }

  // If the message is already somewhat user-friendly (no technical jargon), return it
  const technicalPatterns = [
    /^[A-Z_]+Error/, // ErrorClassName
    /^\[.*\]$/, // [ErrorType: message]
    /^{.*}$/, // JSON-like
    /\b(null|undefined|NaN)\b/i,
    /\bstack\b/i,
    /\btoken\b/i,
    /\baudience\b/i,
    /\bclient.?id\b/i,
  ];

  const isTechnical = technicalPatterns.some(pattern => pattern.test(errorMessage));

  if (!isTechnical && errorMessage.length < 100) {
    // Message seems user-friendly enough, return as-is
    return errorMessage;
  }

  return DEFAULT_ERROR_MESSAGE;
}

/**
 * Rate limit cooldown duration in seconds
 */
export const RESEND_COOLDOWN_SECONDS = 60;
