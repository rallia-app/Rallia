/**
 * Border Radius Tokens
 *
 * Consistent border radius values for rounded corners.
 * Base radius is 1rem (16px) as defined in globals.css.
 */

/**
 * Border radius scale in rem units (for web/Tailwind)
 */
export const radius = {
  none: '0',
  sm: '0.125rem', // 2px
  DEFAULT: '0.25rem', // 4px
  md: '0.375rem', // 6px
  lg: '0.5rem', // 8px
  xl: '0.75rem', // 12px
  '2xl': '1rem', // 16px
  '3xl': '1.5rem', // 24px
  full: '9999px',
} as const;

/**
 * Border radius in pixels (for React Native)
 */
export const radiusPixels = {
  none: 0,
  sm: 2,
  DEFAULT: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  '3xl': 24,
  full: 9999,
} as const;

/**
 * Semantic border radius tokens for common components (theme v2 shape
 * language: pill buttons, 16px cards, 24px sheets/modals, 12px inputs)
 */
export const radiusSemantic = {
  // Buttons are pill-shaped at every size
  buttonSm: radius.full,
  buttonMd: radius.full,
  buttonLg: radius.full,
  buttonPill: radius.full,

  // Cards
  card: radius['2xl'], // 16px
  cardLg: radius['3xl'], // 24px

  // Inputs
  input: radius.xl, // 12px

  // Badges/Tags
  badge: radius.full, // Pill shape
  tag: radius.md, // 6px

  // Avatars
  avatarSm: radius.lg, // 8px
  avatarMd: radius.xl, // 12px
  avatarLg: radius['2xl'], // 16px
  avatarCircle: radius.full, // Circle

  // Modals/Dialogs/Sheets
  modal: radius['3xl'], // 24px
  dialog: radius['2xl'], // 16px

  // Tooltips/Popovers
  tooltip: radius.md, // 6px
  popover: radius.xl, // 12px
} as const;

/**
 * Semantic border radius in pixels (for React Native)
 */
export const radiusSemanticPixels = {
  buttonSm: radiusPixels.full,
  buttonMd: radiusPixels.full,
  buttonLg: radiusPixels.full,
  buttonPill: radiusPixels.full,

  card: radiusPixels['2xl'],
  cardLg: radiusPixels['3xl'],

  input: radiusPixels.xl,

  badge: radiusPixels.full,
  tag: radiusPixels.md,

  avatarSm: radiusPixels.lg,
  avatarMd: radiusPixels.xl,
  avatarLg: radiusPixels['2xl'],
  avatarCircle: radiusPixels.full,

  modal: radiusPixels['3xl'],
  dialog: radiusPixels['2xl'],

  tooltip: radiusPixels.md,
  popover: radiusPixels.xl,
} as const;

export type RadiusKey = keyof typeof radius;
export type RadiusValue = (typeof radius)[RadiusKey];
export type RadiusSemanticKey = keyof typeof radiusSemantic;
