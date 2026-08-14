import { reactNative } from '@rallia/eslint-config/react-native';
import { uiConsistency } from '@rallia/eslint-config/ui-consistency';

export default [
  ...reactNative({ tsconfigRootDir: import.meta.dirname }),
  {
    // Registry-first UI enforcement (warn-level burn-down; see
    // specs/design-system/button-audit.md §3.4). Screens and features only —
    // shared primitives legitimately define these styles.
    files: ['src/screens/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}'],
    ...uiConsistency,
  },
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'android/**',
      'ios/**',
      'babel.config.js',
      'metro.config.js',
      'plugins/**/*.js',
      'analyze-bundle.js',
    ],
  },
  {
    // Asset-generation scripts run under plain node, outside the app's module
    // graph — they can't import the TS-source design-system tokens, so the
    // design-token hex rule doesn't apply.
    files: ['scripts/**'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
