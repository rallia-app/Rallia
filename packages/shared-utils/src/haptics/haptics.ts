/**
 * Haptic Feedback - Base Implementation
 *
 * This file is used for TypeScript type checking.
 * At runtime, bundlers will resolve to platform-specific files:
 * - haptics.native.ts (React Native)
 * - haptics.web.ts (Web)
 */

export {
  lightHaptic,
  mediumHaptic,
  heavyHaptic,
  successHaptic,
  warningHaptic,
  errorHaptic,
  selectionHaptic,
} from './haptics.web';
