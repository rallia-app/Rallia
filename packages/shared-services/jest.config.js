/**
 * Jest Configuration for shared-services package
 */

module.exports = {
  displayName: 'shared-services',
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
        },
      },
    ],
  },

  moduleNameMapper: {
    '^@rallia/shared-types$': '<rootDir>/../shared-types/src',
  },

  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{ts,tsx}',
    '<rootDir>/src/**/*.{spec,test}.{ts,tsx}',
  ],

  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/index.ts'],

  coverageDirectory: '<rootDir>/coverage',

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
