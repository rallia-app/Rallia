import { next } from '@rallia/eslint-config/next';

export default [
  ...next({ tsconfigRootDir: import.meta.dirname }),
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
];
