import { react } from '@rallia/eslint-config/react';

export default [
  ...react({ tsconfigRootDir: import.meta.dirname }),
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
];
