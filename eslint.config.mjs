import globals from 'globals';
import { base } from '@rallia/eslint-config/base';

export default [
  ...base({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      parserOptions: {
        project: null,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.expo/**',
      '*.config.js',
      '*.config.mjs',
      'apps/**',
      'packages/**',
      'supabase/types.ts',
    ],
  },
];
