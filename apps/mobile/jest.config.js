/**
 * Jest configuration for apps/mobile service-layer tests.
 * Covers pure TypeScript services that don't require a device/simulator.
 * React Native UI components are NOT tested here.
 */
module.exports = {
  displayName: 'mobile-services',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          // Skip lib checking to avoid missing RN type errors
          skipLibCheck: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@rallia/shared-services$': '<rootDir>/../../packages/shared-services/src',
    '^@rallia/shared-hooks$': '<rootDir>/../../packages/shared-hooks/src',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/../../node_modules/@react-native-async-storage/async-storage/jest/async-storage-mock.js',
    // Stub out native modules we don't need in these tests
    '^expo-file-system.*$': '<rootDir>/src/__mocks__/expo-file-system.js',
    '^expo-video-thumbnails$': '<rootDir>/src/__mocks__/expo-video-thumbnails.js',
    '^expo-image-manipulator$': '<rootDir>/src/__mocks__/expo-image-manipulator.js',
    '^react-native-compressor$': '<rootDir>/src/__mocks__/react-native-compressor.js',
    '^react-native$': '<rootDir>/src/__mocks__/react-native.js',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
