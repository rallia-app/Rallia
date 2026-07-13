import { react } from '@rallia/eslint-config/react';

export default [
  ...react({ tsconfigRootDir: import.meta.dirname }),
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  {
    // This package defines the color tokens the shared design-token lint rule
    // guards against duplicating — hex literals here are the source of truth.
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
