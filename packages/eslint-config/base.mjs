import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export function base({ tsconfigRootDir } = {}) {
  return tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: ['*.js', '*.mjs', '*.cjs'],
          },
          ...(tsconfigRootDir && { tsconfigRootDir }),
        },
      },
    },
    {
      plugins: {
        'import-x': importPlugin,
      },
      rules: {
        // TypeScript - type-checked rules as warnings for gradual adoption
        '@typescript-eslint/no-floating-promises': 'warn',
        '@typescript-eslint/no-misused-promises': 'warn',
        '@typescript-eslint/await-thenable': 'warn',
        '@typescript-eslint/no-unsafe-assignment': 'warn',
        '@typescript-eslint/no-unsafe-member-access': 'warn',
        '@typescript-eslint/no-unsafe-argument': 'warn',
        '@typescript-eslint/no-unsafe-call': 'warn',
        '@typescript-eslint/no-unsafe-return': 'warn',
        '@typescript-eslint/require-await': 'warn',
        '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
        '@typescript-eslint/no-base-to-string': 'warn',
        '@typescript-eslint/restrict-template-expressions': 'warn',
        '@typescript-eslint/no-redundant-type-constituents': 'warn',
        '@typescript-eslint/unbound-method': 'warn',
        '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
        '@typescript-eslint/prefer-promise-reject-errors': 'warn',
        '@typescript-eslint/no-empty-object-type': 'warn',
        '@typescript-eslint/no-require-imports': 'warn',
        // TypeScript - general
        '@typescript-eslint/no-unused-vars': [
          'warn',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        // Import ordering
        'import-x/order': [
          'warn',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
            'newlines-between': 'always',
          },
        ],
        'import-x/no-duplicates': 'warn',
      },
    },
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      rules: {
        'no-undef': 'off',
      },
    },
    {
      files: [
        '**/*.test.{ts,tsx,js,jsx}',
        '**/*.spec.{ts,tsx,js,jsx}',
        '**/jest.setup.{js,ts}',
        '**/jest.config.{js,ts}',
      ],
      ...tseslint.configs.disableTypeChecked,
      languageOptions: {
        ...tseslint.configs.disableTypeChecked.languageOptions,
        globals: {
          ...globals.jest,
        },
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
      languageOptions: {
        ...tseslint.configs.disableTypeChecked.languageOptions,
        sourceType: 'commonjs',
        globals: {
          ...globals.node,
        },
      },
      rules: {
        ...tseslint.configs.disableTypeChecked.rules,
        'no-redeclare': ['error', { builtinGlobals: false }],
      },
    },
    prettier
  );
}
