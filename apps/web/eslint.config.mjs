import { next } from '@rallia/eslint-config/next';

export default [
  ...next({ tsconfigRootDir: import.meta.dirname }),
  {
    rules: {
      // These are exported from @rallia/shared-hooks but their web builds are stubs
      // that throw at runtime — Metro resolves the real .native.ts, bundlers here do not.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@rallia/shared-hooks',
              importNames: ['useTheme', 'useThemeStyles', 'ThemeProvider'],
              message: 'Theming on web goes through next-themes. These exports throw at runtime.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
];
