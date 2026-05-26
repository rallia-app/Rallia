import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactNativePlugin from 'eslint-plugin-react-native';
import globals from 'globals';
import { react } from './react.mjs';

// React Compiler / Rules of React lint rules. The mobile app enables React
// Compiler (app.json experiments.reactCompiler); these rules surface the
// patterns that make the compiler bail out and where manual memoization is
// still load-bearing. They start at 'warn' for incremental adoption on the
// existing codebase (~300 pre-existing violations) without breaking lint/CI;
// ratchet individual rules to 'error' as the violations are burned down.
// rules-of-hooks stays 'error' since it was already enforced. The react-hooks
// plugin itself is registered by react().
const reactCompilerRules = Object.fromEntries(
  Object.keys(reactHooksPlugin.configs['recommended-latest'].rules).map(name => [
    name,
    name === 'react-hooks/rules-of-hooks' ? 'error' : 'warn',
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
