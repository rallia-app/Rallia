/**
 * Phone Verification Service
 *
 * Thin client for the `verify-phone` Edge Function (Twilio Verify OTP).
 * On successful check, the function writes profile.phone + phone_verified
 * server-side and records CASL consent; clients only read the result.
 */

import { supabase } from '../supabase';

export type PhoneVerificationErrorCode =
  | 'invalid_phone'
  | 'incorrect_code'
  | 'code_expired'
  | 'rate_limited'
  | 'unauthorized'
  | 'unknown';

export type PhoneVerificationSource = 'onboarding' | 'settings';

const KNOWN_ERROR_CODES: PhoneVerificationErrorCode[] = [
  'invalid_phone',
  'incorrect_code',
  'code_expired',
  'rate_limited',
  'unauthorized',
];

async function extractErrorCode(error: {
  context?: Response;
  message?: string;
}): Promise<PhoneVerificationErrorCode> {
  // FunctionsHttpError stores the raw Response in `context`; `data` is null on non-2xx.
  if (error.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json();
      if (KNOWN_ERROR_CODES.includes(body?.error)) {
        return body.error;
      }
    } catch {
      // fall through
    }
  }
  return 'unknown';
}

export async function sendPhoneVerificationCode(
  phone: string
): Promise<{ success: boolean; errorCode?: PhoneVerificationErrorCode }> {
  const { error } = await supabase.functions.invoke('verify-phone', {
    body: { action: 'send', phone },
  });
  if (error) {
    return { success: false, errorCode: await extractErrorCode(error) };
  }
  return { success: true };
}

export async function checkPhoneVerificationCode(
  phone: string,
  code: string,
  source: PhoneVerificationSource
): Promise<{ success: boolean; phone?: string; errorCode?: PhoneVerificationErrorCode }> {
  const { data, error } = await supabase.functions.invoke('verify-phone', {
    body: { action: 'check', phone, code, source },
  });
  if (error) {
    return { success: false, errorCode: await extractErrorCode(error) };
  }
  return { success: true, phone: data?.phone };
}
