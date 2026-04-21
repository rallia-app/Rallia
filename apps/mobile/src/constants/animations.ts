/**
 * Animation timing constants used throughout the app
 */
export const ANIMATION_DELAYS = {
  // Overlay transition delays
  OVERLAY_STAGGER: 300, // Delay between showing multiple overlays
  OVERLAY_TRANSITION: 800, // Time to wait for overlay to close before showing next
  OVERLAY_RESET: 300, // Time to wait before resetting overlay state

  // General
  SHORT_DELAY: 300,
  MEDIUM_DELAY: 500,
  LONG_DELAY: 800,
} as const;

export const ANIMATION_DURATIONS = {
  FAST: 200,
  NORMAL: 300,
  SLOW: 500,
  VERY_SLOW: 800,
} as const;
