/**
 * Jest setup for @rallia/shared-components
 *
 * This file runs before each test file in the suite.
 */

// Silence console warnings during tests
global.console = {
  ...console,
  // Uncomment to ignore specific console methods
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};
