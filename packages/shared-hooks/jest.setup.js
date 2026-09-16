/**
 * Jest Setup for shared-hooks package
 *
 * Mocks and global test configuration
 */

// Mock Supabase client
jest.mock('@rallia/shared-services', () => ({
  getUsableSession: jest.fn(() => Promise.resolve({ access_token: 'token' })),
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(),
        })),
        order: jest.fn(() => ({
          eq: jest.fn(),
        })),
      })),
    })),
  },
}));

// Suppress console errors in tests (optional)
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
};
