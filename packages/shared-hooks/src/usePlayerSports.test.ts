/**
 * Tests for usePlayerSports hook
 *
 * Tests cover:
 * - Initial loading state
 * - Successful player sports fetch
 * - Nested sport data handling (array vs object)
 * - Error handling
 * - Refetch functionality
 * - Player ID parameter handling
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { usePlayerSports } from './usePlayerSports';
import { supabase } from '@rallia/shared-services';

jest.mock('@rallia/shared-services');

// usePlayerSports is now backed by React Query, so every render needs a
// QueryClientProvider. A fresh client per render keeps cached results from
// leaking across tests; retry:false makes the error case surface immediately
// instead of retrying with backoff (which would hang the test).
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'QueryClientTestWrapper';
  return Wrapper;
}

describe('usePlayerSports', () => {
  const mockPlayerId = 'player-123';

  const mockPlayerSports = [
    {
      player_id: 'player-123',
      sport_id: 'sport-1',
      is_primary: true,
      preferred_match_duration: 90,
      preferred_match_type: 'competitive' as const,
      sport: {
        id: 'sport-1',
        name: 'tennis',
        display_name: 'Tennis',
        is_active: true,
      },
    },
    {
      player_id: 'player-123',
      sport_id: 'sport-2',
      is_primary: false,
      preferred_match_duration: 60,
      preferred_match_type: 'casual' as const,
      sport: {
        id: 'sport-2',
        name: 'pickleball',
        display_name: 'Pickleball',
        is_active: true,
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should start with loading true and empty array when playerId provided', () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest
            .fn()
            .mockImplementation(
              () =>
                new Promise(resolve => setTimeout(() => resolve({ data: mockPlayerSports }), 100))
            ),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.playerSports).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should return empty array and not loading when playerId is undefined', async () => {
      const { result } = renderHook(() => usePlayerSports(undefined), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('Successful Player Sports Fetch', () => {
    it('should fetch player sports for provided player ID', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: mockPlayerSports,
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toEqual(mockPlayerSports);
      expect(result.current.error).toBeNull();
    });

    it('should include nested sport data', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: mockPlayerSports,
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      result.current.playerSports.forEach(ps => {
        expect(ps.sport).toBeDefined();
        expect(ps.sport).toHaveProperty('id');
        expect(ps.sport).toHaveProperty('name');
        expect(ps.sport).toHaveProperty('display_name');
      });
    });
  });

  describe('Nested Sport Data Handling', () => {
    it('should handle sport as object', async () => {
      const dataWithObjectSport = mockPlayerSports.map(ps => ({
        ...ps,
        sport: ps.sport, // Sport as object
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: dataWithObjectSport,
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toHaveLength(2);
      expect(result.current.playerSports[0].sport).toEqual(mockPlayerSports[0].sport);
    });

    it('should handle sport as array (single element)', async () => {
      const dataWithArraySport = mockPlayerSports.map(ps => ({
        ...ps,
        sport: [ps.sport], // Sport as array
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: dataWithArraySport,
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toHaveLength(2);
      // Hook should handle array and return the data as-is
      expect(Array.isArray(result.current.playerSports[0].sport)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle player sports fetch error', async () => {
      const mockError = {
        message: 'Failed to fetch player sports',
        code: '500',
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: null,
            error: mockError,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toEqual([]);
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Failed to fetch player sports');
    });

    it('should handle null data gracefully', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Refetch Functionality', () => {
    it('should allow manual refetch', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: mockPlayerSports,
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toHaveLength(2);

      // Clear mocks
      jest.clearAllMocks();

      // Add new player sport
      const newPlayerSport = {
        player_id: 'player-123',
        sport_id: 'sport-3',
        is_primary: false,
        preferred_match_duration: 45,
        preferred_match_type: 'both' as const,
        sport: {
          id: 'sport-3',
          name: 'badminton',
          display_name: 'Badminton',
          is_active: true,
        },
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: [...mockPlayerSports, newPlayerSport],
            error: null,
          }),
        }),
      });

      // Trigger refetch
      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.playerSports).toHaveLength(3);
      });

      expect(result.current.playerSports).toContainEqual(newPlayerSport);
    });
  });

  describe('Player ID Changes', () => {
    it('should refetch when playerId prop changes', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: mockPlayerSports,
            error: null,
          }),
        }),
      });

      const { result, rerender } = renderHook(({ playerId }) => usePlayerSports(playerId), {
        initialProps: { playerId: 'player-123' },
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toHaveLength(2);

      // Change playerId
      rerender({ playerId: 'player-456' });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should have fetched for new player
      expect(supabase.from).toHaveBeenCalledTimes(2);
    });

    it('should clear data when playerId becomes undefined', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: mockPlayerSports,
            error: null,
          }),
        }),
      });

      const { result, rerender } = renderHook(({ playerId }) => usePlayerSports(playerId), {
        initialProps: { playerId: 'player-123' as string | undefined },
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toHaveLength(2);

      // Clear playerId (user signed out)
      rerender({ playerId: undefined });

      await waitFor(() => {
        expect(result.current.playerSports).toEqual([]);
      });
    });
  });

  describe('Data Validation', () => {
    it('should handle player with no sports', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.playerSports).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should preserve all player sport fields', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: mockPlayerSports,
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => usePlayerSports(mockPlayerId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      result.current.playerSports.forEach(ps => {
        expect(ps).toHaveProperty('player_id');
        expect(ps).toHaveProperty('sport_id');
        expect(ps).toHaveProperty('is_primary');
        expect(ps).toHaveProperty('preferred_match_duration');
        expect(ps).toHaveProperty('preferred_match_type');
        expect(ps).toHaveProperty('sport');
      });
    });
  });
});
