/**
 * E2E automation flag.
 *
 * Set EXPO_PUBLIC_E2E=1 for Maestro / automated UI runs to suppress
 * non-deterministic auto-opening sheets (referral prompt, weekly check-in,
 * Série 1 announcement, pending match-feedback) that otherwise hijack
 * the screen and make flows flaky. Off in all normal builds.
 */
export const IS_E2E = process.env.EXPO_PUBLIC_E2E === '1';
