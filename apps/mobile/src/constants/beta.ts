/**
 * Beta testing expiry — all beta UI auto-hides after this date.
 * April 24, 2026 23:59:59 EST = April 25, 2026 05:00:00 UTC
 */
export const BETA_EXPIRY_MS = Date.UTC(2026, 3, 25, 5, 0, 0);

export const isBetaExpired = () => Date.now() >= BETA_EXPIRY_MS;
