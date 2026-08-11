/**
 * Design System Tailwind Preset (JavaScript)
 *
 * This file provides a CommonJS-compatible export for use in tailwind.config.js
 * which runs in Node.js at build time (not through a TypeScript transpiler).
 *
 * Colors and tokens are kept in sync with ./src/tokens/colors.ts
 */

const primary = {
  50: '#f0faf7',
  100: '#d6f5ee',
  200: '#a9ebdf',
  300: '#6bdcc9',
  400: '#17c9b4',
  500: '#0fa893',
  600: '#007a6e',
  700: '#06635b',
  800: '#0a4e48',
  900: '#0d3b38',
  950: '#062220',
  DEFAULT: '#0fa893',
};

const secondary = {
  50: '#fef1ef',
  100: '#fde2df',
  200: '#fbc5bf',
  300: '#f9a390',
  400: '#ff8b76',
  500: '#f2554b',
  600: '#d0433a',
  700: '#a93129',
  800: '#7f231d',
  900: '#571713',
  950: '#300b08',
  DEFAULT: '#f2554b',
};

const accent = {
  50: '#fdf6e7',
  100: '#faebc8',
  200: '#f6d98f',
  300: '#ffc94d',
  400: '#f5b535',
  500: '#e8a020',
  600: '#c68414',
  700: '#9c660f',
  800: '#734a0c',
  900: '#4e3108',
  950: '#2b1a04',
  DEFAULT: '#e8a020',
};

const neutral = {
  50: '#f4f9f8',
  100: '#e9f1ef',
  200: '#dce8e5',
  300: '#c4d4d0',
  400: '#93a8a2',
  500: '#5c6f6b',
  600: '#475753',
  700: '#35423f',
  800: '#232e2c',
  900: '#15211f',
  950: '#0c1514',
};

const status = {
  success: {
    light: '#10b981',
    DEFAULT: '#059669',
    dark: '#047857',
  },
  error: {
    light: '#f87171',
    DEFAULT: '#ef4444',
    dark: '#dc2626',
  },
  warning: {
    light: '#fbbf24',
    DEFAULT: '#f59e0b',
    dark: '#d97706',
  },
  info: {
    light: '#38bdf8',
    DEFAULT: '#0ea5e9',
    dark: '#0284c7',
  },
};

const tailwindColors = {
  transparent: 'transparent',
  current: 'currentColor',
  black: '#000000',
  white: '#ffffff',
  primary,
  secondary,
  accent,
  neutral,
  success: status.success,
  error: status.error,
  warning: status.warning,
  info: status.info,
};

const spacing = {
  0: '0',
  px: '1px',
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  2.5: '0.625rem',
  3: '0.75rem',
  3.5: '0.875rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  7: '1.75rem',
  8: '2rem',
  9: '2.25rem',
  10: '2.5rem',
  11: '2.75rem',
  12: '3rem',
  14: '3.5rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  28: '7rem',
  32: '8rem',
  36: '9rem',
  40: '10rem',
  44: '11rem',
  48: '12rem',
  52: '13rem',
  56: '14rem',
  60: '15rem',
  64: '16rem',
  72: '18rem',
  80: '20rem',
  96: '24rem',
};

const borderRadius = {
  none: '0',
  sm: '0.125rem',
  DEFAULT: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
};

const fontFamily = {
  heading: ['Poppins', 'sans-serif'],
  body: ['Inter', 'sans-serif'],
  mono: ['Fira Code', 'Consolas', 'monospace'],
  sans: ['Inter', 'sans-serif'],
};

const tailwindPreset = {
  theme: {
    extend: {
      colors: tailwindColors,
      fontFamily,
      spacing,
      borderRadius,
    },
  },
};

module.exports = {
  tailwindPreset,
  tailwindColors,
  primary,
  secondary,
  accent,
  neutral,
  status,
  spacing,
  borderRadius,
  fontFamily,
};
