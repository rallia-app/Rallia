/**
 * Jest Configuration for shared-hooks package
 */

module.exports = {
  displayName: 'shared-hooks',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',

  // Root directory for this package
  rootDir: '.',

  // Transform TypeScript files
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },

  // Module name mapping for @rallia packages
  moduleNameMapper: {
    '^@rallia/shared-types$': '<rootDir>/../shared-types/src',
    '^@rallia/shared-services$': '<rootDir>/../shared-services/src',
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Test match patterns
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{ts,tsx}',
    '<rootDir>/src/**/*.{spec,test}.{ts,tsx}',
  ],

  // Coverage configuration
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/index.ts'],

  coverageDirectory: '<rootDir>/coverage',

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
