import reactNativePlugin from 'eslint-plugin-react-native';
import globals from 'globals';
import { react } from './react.mjs';

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
        'react-native/no-unused-styles': 'warn',
        'react-native/split-platform-components': 'warn',
        'react-native/no-inline-styles': 'off',
        'react-native/no-color-literals': 'off',
        'react-native/no-raw-text': 'off',
      },
    },
  ];
}
