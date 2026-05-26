import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactNativePlugin from 'eslint-plugin-react-native';
import globals from 'globals';
import { react } from './react.mjs';

// React Compiler / Rules of React lint rules. The mobile app enables React
// Compiler (app.json experiments.reactCompiler); these rules surface the
// patterns that make the compiler bail out and where manual memoization is
// still load-bearing. Rules start at 'warn' for incremental adoption on the
// existing codebase without breaking lint/CI, and get ratcheted to 'error'
// once their violations are fully burned down so regressions can't creep back.
// The react-hooks plugin itself is registered by react().
const errorRules = new Set([
  'react-hooks/rules-of-hooks', // already enforced before the compiler
  'react-hooks/preserve-manual-memoization', // burned down to 0 (2026-05-25)
  'react-hooks/static-components', // burned down to 0 (2026-05-25)
]);
const reactCompilerRules = Object.fromEntries(
  Object.keys(reactHooksPlugin.configs['recommended-latest'].rules).map(name => [
    name,
    errorRules.has(name) ? 'error' : 'warn',
  ])
);

export function reactNative({ tsconfigRootDir } = {}) {
  return [
    ...react({ tsconfigRootDir }),
    {
      plugins: {
        'react-native': reactNativePlugin,
      },
      languageOptions: {
        globals: {
          ...globals.node,
        },
      },
      rules: {
        ...reactCompilerRules,
        'react-native/no-unused-styles': 'warn',
        'react-native/split-platform-components': 'warn',
        'react-native/no-inline-styles': 'off',
        'react-native/no-color-literals': 'off',
        'react-native/no-raw-text': 'off',
      },
    },
  ];
}
