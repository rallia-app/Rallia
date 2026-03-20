/**
 * Tests for useSports hook
 *
 * Tests cover:
 * - Initial loading state
 * - Successful sports fetch
 * - Active sports filtering
 * - Error handling
 * - Refetch functionality
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useSports } from './useSports';
import { supabase } from '@rallia/shared-services';

jest.mock('@rallia/shared-services');

describe('useSports', () => {
  const mockSports = [
    {
      id: 'sport-1',
      name: 'tennis',
      display_name: 'Tennis',
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'sport-2',
      name: 'pickleball',
      display_name: 'Pickleball',
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should start with loading true and empty sports array', () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest
              .fn()
              .mockImplementation(
                () => new Promise(resolve => setTimeout(() => resolve({ data: mockSports }), 100))
              ),
          }),
        }),
      });

      const { result } = renderHook(() => useSports());

      expect(result.current.loading).toBe(true);
      expect(result.current.sports).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Successful Sports Fetch', () => {
    it('should fetch all active sports', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: mockSports,
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sports).toEqual(mockSports);
      expect(result.current.error).toBeNull();
    });

    it('should order sports by name', async () => {
      const unorderedSports = [
        { ...mockSports[1], name: 'pickleball' },
        { ...mockSports[0], name: 'tennis' },
      ];

      const mockFrom = {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: unorderedSports,
              error: null,
            }),
          }),
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockFrom);

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Verify order was called with 'name'
      expect(mockFrom.select().eq().order).toHaveBeenCalledWith('name');
    });

    it('should filter only active sports', async () => {
      const mockFrom = {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: mockSports,
              error: null,
            }),
          }),
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockFrom);

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Verify eq was called with is_active: true
      expect(mockFrom.select().eq).toHaveBeenCalledWith('is_active', true);
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch error', async () => {
      const mockError = {
        message: 'Failed to fetch sports',
        code: '500',
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: null,
              error: mockError,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sports).toEqual([]);
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Failed to fetch sports');
    });

    it('should handle unexpected errors', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Network error');
      });

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sports).toEqual([]);
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Network error');
    });

    it('should handle null data gracefully', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sports).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Refetch Functionality', () => {
    it('should allow manual refetch', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: mockSports,
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sports).toEqual(mockSports);

      // Clear mocks
      jest.clearAllMocks();

      // Add new sport
      const newSport = {
        id: 'sport-3',
        name: 'badminton',
        display_name: 'Badminton',
        is_active: true,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [...mockSports, newSport],
              error: null,
            }),
          }),
        }),
      });

      // Trigger refetch
      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.sports).toHaveLength(3);
      });

      expect(result.current.sports).toContainEqual(newSport);
    });

    it('should handle refetch errors', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: mockSports,
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock error on refetch
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'Refetch failed' },
            }),
          }),
        }),
      });

      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.error?.message).toBe('Refetch failed');
      });

      // Sports array should be cleared on error
      expect(result.current.sports).toEqual([]);
    });
  });

  describe('Data Validation', () => {
    it('should handle empty sports list', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sports).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should preserve sport data structure', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: mockSports,
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useSports());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      result.current.sports.forEach((sport: any) => {
        expect(sport).toHaveProperty('id');
        expect(sport).toHaveProperty('name');
        expect(sport).toHaveProperty('display_name');
        expect(sport).toHaveProperty('is_active');
        expect(sport.is_active).toBe(true);
      });
    });
  });
});
