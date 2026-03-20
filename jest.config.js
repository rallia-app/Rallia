/**
 * Jest Configuration for Rallia Monorepo
 *
 * Root configuration that delegates to package-specific configs
 */

module.exports = {
  // Use projects to run tests in each package
  projects: [
    '<rootDir>/packages/shared-hooks',
    '<rootDir>/packages/shared-services',
    '<rootDir>/packages/shared-utils',
    '<rootDir>/packages/shared-components',
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'packages/*/src/**/*.{ts,tsx}',
    '!packages/*/src/**/*.d.ts',
    '!packages/*/src/**/*.stories.tsx',
    '!packages/*/src/index.ts',
  ],

  coverageThresholds: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/apps/', '/dist/', '/build/'],
};
