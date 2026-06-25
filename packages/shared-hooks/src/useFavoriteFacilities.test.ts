/**
 * Tests for useFavoriteFacilities hook
 *
 * Focus: the synthetic-id guard. When the sport catalog fetch fails during
 * onboarding the app falls back to placeholder sport ids like `tennis-fallback`.
 * Those must never reach the uuid `sport_id`/`player_id` columns, or Postgres
 * rejects the whole query ("invalid input syntax for type uuid").
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useFavoriteFacilities } from './useFavoriteFacilities';
import { supabase } from '@rallia/shared-services';

jest.mock('@rallia/shared-services');

const PLAYER_UUID = '11111111-1111-4111-8111-111111111111';
const SPORT_UUID = '22222222-2222-4222-8222-222222222222';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'QueryClientTestWrapper';
  return Wrapper;
}

/** Self-referential chainable query builder that resolves to `result`. */
function mockQuery(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  (supabase.from as jest.Mock).mockReturnValue(builder);
  return builder;
}

describe('useFavoriteFacilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips the query and returns no favorites for a synthetic fallback sportId', async () => {
    const { result } = renderHook(() => useFavoriteFacilities(PLAYER_UUID, 'tennis-fallback'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.favorites).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('skips the query when playerId is not a uuid', async () => {
    const { result } = renderHook(() => useFavoriteFacilities('not-a-uuid', SPORT_UUID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.favorites).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('queries normally when both ids are valid uuids', async () => {
    mockQuery({
      data: [
        {
          id: 'fav-1',
          facility_id: 'fac-1',
          sport_id: SPORT_UUID,
          display_order: 1,
          facility: {
            id: 'fac-1',
            name: 'Parc Jeanne-Mance',
            address: null,
            city: 'Montréal',
            latitude: 45.5,
            longitude: -73.5,
          },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useFavoriteFacilities(PLAYER_UUID, SPORT_UUID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(supabase.from).toHaveBeenCalledWith('player_favorite_facility');
    expect(result.current.favorites).toHaveLength(1);
    expect(result.current.favorites[0]).toMatchObject({
      id: 'fav-1',
      facilityId: 'fac-1',
      sportId: SPORT_UUID,
      displayOrder: 1,
    });
    expect(result.current.error).toBeNull();
  });

  it('does not require a sportId to query (player-wide favorites)', async () => {
    mockQuery({ data: [], error: null });

    const { result } = renderHook(() => useFavoriteFacilities(PLAYER_UUID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(supabase.from).toHaveBeenCalledWith('player_favorite_facility');
    expect(result.current.favorites).toEqual([]);
  });
});
