/**
 * Spacing System
 *
 * Provides consistent spacing scale for margins, paddings, and gaps
 * Based on 4px base unit
 */

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export type Spacing = keyof typeof spacing;

/**
 * Border Radius System
 *
 * Derived from @rallia/design-system (theme v2 shape language) so there is
 * a single source of truth: 6 tags, 12 inputs, 16 cards, 24 sheets.
 */
import { radiusPixels, shadowsNative } from '@rallia/design-system';

export const borderRadius = {
  none: radiusPixels.none,
  sm: radiusPixels.md, // 6 — tags/chips
  base: radiusPixels.xl, // 12 — inputs, small surfaces
  md: radiusPixels['2xl'], // 16 — cards
  lg: radiusPixels['2xl'], // 16 — cards (legacy alias)
  xl: radiusPixels['3xl'], // 24 — sheets/modals
  '2xl': 32,
  full: radiusPixels.full,
} as const;

export type BorderRadius = keyof typeof borderRadius;

/**
 * Shadow System (for elevated components)
 * Re-exported from the design system's native shadow tokens.
 */
export const shadows = {
  none: shadowsNative.none,
  sm: shadowsNative.sm,
  base: shadowsNative.DEFAULT,
  md: shadowsNative.md,
  lg: shadowsNative.lg,
  xl: shadowsNative.xl,
} as const;

export type Shadow = keyof typeof shadows;
