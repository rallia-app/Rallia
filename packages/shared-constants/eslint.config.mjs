import { base } from '@rallia/eslint-config/base';

export default [
  ...base({ tsconfigRootDir: import.meta.dirname }),
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
];
