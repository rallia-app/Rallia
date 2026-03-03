import { reactNative } from '@rallia/eslint-config/react-native';

export default [
  ...reactNative({ tsconfigRootDir: import.meta.dirname }),
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'android/**',
      'ios/**',
      'babel.config.js',
      'metro.config.js',
      'tailwind.config.js',
      'plugins/**/*.js',
      'analyze-bundle.js',
    ],
  },
];
