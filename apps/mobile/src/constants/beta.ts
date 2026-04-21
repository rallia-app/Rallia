/**
 * Launch moment — Saturday 2026-04-25 00:00 America/Toronto (EDT, UTC-4).
 * The launch countdown targets this timestamp and then stops rendering.
 */
export const LAUNCH_MS = Date.UTC(2026, 3, 25, 4, 0, 0);

export const isLaunched = () => Date.now() >= LAUNCH_MS;

/**
 * Beta testing expiry — all beta UI auto-hides after this date.
 * April 24, 2026 23:59:59 EST = April 25, 2026 05:00:00 UTC.
 * Note: this is intentionally 1h after LAUNCH_MS so the "BETA" label keeps
 * showing for a short grace period after launch before everything hides.
 */
export const BETA_EXPIRY_MS = Date.UTC(2026, 3, 25, 5, 0, 0);

export const isBetaExpired = () => Date.now() >= BETA_EXPIRY_MS;
