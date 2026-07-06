import { reactNative } from '@rallia/eslint-config/react-native';

export default [
  ...reactNative({ tsconfigRootDir: import.meta.dirname }),
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
