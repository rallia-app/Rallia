import { base } from '@rallia/eslint-config/base';

export default [
  ...base({ tsconfigRootDir: import.meta.dirname }),
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  {
    // Legacy palette definitions live here; they are palette source files, not
    // consumers hand-copying design-system tokens.
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
