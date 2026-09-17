/**
 * Tests for useProfile hook
 *
 * Tests cover:
 * - Initial loading state
 * - Successful profile fetch
 * - Error handling
 * - Refetch functionality
 * - User ID parameter handling
 */

import { renderHook, waitFor, render, screen, act } from '@testing-library/react';
import { useProfile, ProfileProvider } from './useProfile';
import { supabase, getUsableSession } from '@rallia/shared-services';
import React from 'react';

// Mock Supabase
jest.mock('@rallia/shared-services');

describe('useProfile', () => {
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
  };

  const mockProfile = {
    id: 'user-123',
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    display_name: 'TestUser',
    profile_picture_url: 'https://example.com/avatar.jpg',
    date_of_birth: '1990-01-01',
    gender: 'male',
    phone_number: '+1234567890',
    bio: 'Test bio',
    city: 'Test City',
    state_province: 'Test State',
    country: 'Test Country',
    rating: 4.5,
    matches_played: 10,
    matches_won: 7,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getUsableSession as jest.Mock).mockResolvedValue({ access_token: 'token' });
  });

  const mockProfileQuery = (result: { data: unknown; error: unknown }) => {
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue(result),
        }),
      }),
    });
  };

  describe('Initial State', () => {
    it('should start with loading true and null profile', () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest
              .fn()
              .mockImplementation(
                () => new Promise(resolve => setTimeout(() => resolve({ data: mockProfile }), 100))
              ),
          }),
        }),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ProfileProvider userId={mockUser.id}>{children}</ProfileProvider>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      expect(result.current.loading).toBe(true);
      expect(result.current.profile).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('Successful Profile Fetch', () => {
    it('should fetch profile for authenticated user', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: mockProfile,
              error: null,
            }),
          }),
        }),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ProfileProvider userId={mockUser.id}>{children}</ProfileProvider>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profile).toEqual(mockProfile);
      expect(result.current.error).toBeNull();
    });

    it('should fetch profile for specific user ID using refetchForUser', async () => {
      const targetUserId = 'user-456';

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { ...mockProfile, id: targetUserId },
              error: null,
            }),
          }),
        }),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ProfileProvider userId={mockUser.id}>{children}</ProfileProvider>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Use refetchForUser to fetch a different user's profile
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { ...mockProfile, id: targetUserId },
              error: null,
            }),
          }),
        }),
      });

      await result.current.refetchForUser(targetUserId);

      await waitFor(() => {
        expect(result.current.profile?.id).toBe(targetUserId);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing userId gracefully', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ProfileProvider userId={undefined}>{children}</ProfileProvider>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profile).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should handle profile fetch error', async () => {
      const mockError = {
        message: 'Profile not found',
        code: '404',
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: null,
              error: mockError,
            }),
          }),
        }),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ProfileProvider userId={mockUser.id}>{children}</ProfileProvider>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profile).toBeNull();
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Profile not found');
    });

    it('should handle unexpected errors during fetch', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockRejectedValue(new Error('Network error')),
          }),
        }),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ProfileProvider userId={mockUser.id}>{children}</ProfileProvider>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profile).toBeNull();
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('Refetch Functionality', () => {
    it('should allow manual refetch', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: mockProfile,
              error: null,
            }),
          }),
        }),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ProfileProvider userId={mockUser.id}>{children}</ProfileProvider>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profile).toEqual(mockProfile);

      // Update mock to return updated profile
      const updatedProfile = { ...mockProfile, display_name: 'Updated Name' };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: updatedProfile,
              error: null,
            }),
          }),
        }),
      });

      // Trigger refetch
      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.profile?.display_name).toBe('Updated Name');
      });
    });

    it('should handle refetch errors', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: mockProfile,
              error: null,
            }),
          }),
        }),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ProfileProvider userId={mockUser.id}>{children}</ProfileProvider>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock error on refetch
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
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
    });
  });

  describe('User ID Changes', () => {
    it('should refetch when ProfileProvider userId changes', async () => {
      const TestComponent = () => {
        const { profile, loading } = useProfile();
        return (
          <div data-testid="profile-display">
            {loading ? 'Loading' : `Profile: ${profile?.id || 'null'}`}
          </div>
        );
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: mockProfile,
              error: null,
            }),
          }),
        }),
      });

      const { rerender } = render(
        <ProfileProvider userId="user-123">
          <TestComponent />
        </ProfileProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('profile-display').textContent).toBe('Profile: user-123');
      });

      // Update mock for new userId
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { ...mockProfile, id: 'user-456' },
              error: null,
            }),
          }),
        }),
      });

      // Change userId in provider
      rerender(
        <ProfileProvider userId="user-456">
          <TestComponent />
        </ProfileProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('profile-display').textContent).toBe('Profile: user-456');
      });

      // Should have fetched new profile
      expect(supabase.from).toHaveBeenCalledTimes(2);
    });
  });
  describe('status', () => {
    const wrapperFor = (userId: string | undefined) => {
      function Wrapper({ children }: { children: React.ReactNode }) {
        return <ProfileProvider userId={userId}>{children}</ProfileProvider>;
      }
      return Wrapper;
    };

    it('is guest without a user', async () => {
      const { result } = renderHook(() => useProfile(), { wrapper: wrapperFor(undefined) });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status).toBe('guest');
    });

    it('goes loading then ready when the profile loads', async () => {
      mockProfileQuery({ data: mockProfile, error: null });

      const { result } = renderHook(() => useProfile(), { wrapper: wrapperFor(mockUser.id) });

      expect(result.current.status).toBe('loading');

      await waitFor(() => expect(result.current.status).toBe('ready'));
    });

    it('is unavailable, never missing, when the fetch fails without a known profile', async () => {
      mockProfileQuery({ data: null, error: { message: 'network' } });

      const { result } = renderHook(() => useProfile(), { wrapper: wrapperFor(mockUser.id) });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status).toBe('unavailable');
      expect(result.current.profile).toBeNull();
    });

    it('is unavailable when no usable session exists (anon-key fallback)', async () => {
      (getUsableSession as jest.Mock).mockResolvedValue(null);
      // Under RLS an anon read answers "no row", which must not become "missing".
      mockProfileQuery({ data: null, error: null });

      const { result } = renderHook(() => useProfile(), { wrapper: wrapperFor(mockUser.id) });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status).toBe('unavailable');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('is missing only on a clean empty answer', async () => {
      mockProfileQuery({ data: null, error: null });

      const { result } = renderHook(() => useProfile(), { wrapper: wrapperFor(mockUser.id) });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.status).toBe('missing');
    });

    it('stays ready on a refetch error, keeping the last-known profile', async () => {
      mockProfileQuery({ data: mockProfile, error: null });

      const { result } = renderHook(() => useProfile(), { wrapper: wrapperFor(mockUser.id) });

      await waitFor(() => expect(result.current.status).toBe('ready'));

      mockProfileQuery({ data: null, error: { message: 'network' } });
      await result.current.refetch();

      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.status).toBe('ready');
      expect(result.current.profile).toEqual(mockProfile);
    });

    it('stays loading for a newly signed-in user until their own fetch settles', async () => {
      mockProfileQuery({ data: null, error: null });

      let signIn: (userId: string | undefined) => void = () => {};
      function Wrapper({ children }: { children: React.ReactNode }) {
        const [userId, setUserId] = React.useState<string | undefined>(undefined);
        signIn = setUserId;
        return <ProfileProvider userId={userId}>{children}</ProfileProvider>;
      }

      const { result } = renderHook(() => useProfile(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.status).toBe('guest'));

      act(() => signIn(mockUser.id));

      expect(result.current.status).toBe('loading');
      await waitFor(() => expect(result.current.status).toBe('missing'));
    });
  });
});
