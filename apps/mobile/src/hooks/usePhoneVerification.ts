/**
 * usePhoneVerification
 *
 * State machine over the verify-phone edge function. Shared by the onboarding
 * PersonalInfoStep and the profile-edit PersonalInformationOverlay.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { sendPhoneVerificationCode, checkPhoneVerificationCode } from '@rallia/shared-services';
import type { PhoneVerificationErrorCode, PhoneVerificationSource } from '@rallia/shared-services';
import type { TranslationKey } from '@rallia/shared-translations';
import * as Analytics from '#/services/analytics';

const RESEND_COOLDOWN_SECONDS = 60;

const ERROR_KEYS: Record<PhoneVerificationErrorCode, TranslationKey> = {
  invalid_phone: 'phoneVerification.errors.invalidPhone',
  incorrect_code: 'phoneVerification.errors.incorrectCode',
  code_expired: 'phoneVerification.errors.codeExpired',
  rate_limited: 'phoneVerification.errors.rateLimited',
  unauthorized: 'phoneVerification.errors.sessionExpired',
  unknown: 'phoneVerification.errors.generic',
};

export type PhoneVerificationStatus = 'idle' | 'sending' | 'code_sent' | 'checking' | 'verified';

interface UsePhoneVerificationParams {
  source: PhoneVerificationSource;
  onVerified: (phone: string) => void;
}

export function usePhoneVerification({ source, onVerified }: UsePhoneVerificationParams) {
  const [status, setStatus] = useState<PhoneVerificationStatus>('idle');
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const phoneRef = useRef('');
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
  }, []);

  const startCooldown = useCallback(() => {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    cooldownInterval.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) {
          if (cooldownInterval.current) clearInterval(cooldownInterval.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const sendCode = useCallback(
    async (phone: string) => {
      phoneRef.current = phone;
      setErrorKey(null);
      setStatus('sending');
      const result = await sendPhoneVerificationCode(phone);
      if (result.success) {
        Analytics.phoneCodeSent({ source });
        setStatus('code_sent');
        startCooldown();
      } else {
        setErrorKey(ERROR_KEYS[result.errorCode ?? 'unknown']);
        setStatus('idle');
      }
    },
    [source, startCooldown]
  );

  const checkCode = useCallback(
    async (code: string) => {
      setErrorKey(null);
      setStatus('checking');
      const result = await checkPhoneVerificationCode(phoneRef.current, code, source);
      if (result.success) {
        Analytics.phoneVerified({ source });
        setStatus('verified');
        onVerified(result.phone ?? phoneRef.current);
      } else {
        setErrorKey(ERROR_KEYS[result.errorCode ?? 'unknown']);
        setStatus('code_sent');
      }
    },
    [source, onVerified]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorKey(null);
    setResendCooldown(0);
    if (cooldownInterval.current) clearInterval(cooldownInterval.current);
  }, []);

  return {
    status,
    errorKey,
    resendCooldown,
    canResend: resendCooldown === 0,
    sendCode,
    checkCode,
    reset,
  };
}
