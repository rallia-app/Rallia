/**
 * useNotifications Hook
 * Custom hook for managing notifications with TanStack Query.
 * Provides infinite scrolling, optimistic updates, and real-time state management.
 */

import {
  useInfiniteQuery,
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
  InfiniteData,
} from '@tanstack/react-query';
import {
  getNotifications,
  getUnreadCount,
  getUnreadCountForSport,
  getUnreadCountBySport,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from '@rallia/shared-services';
import type {
  Notification,
  NotificationsPage,
  NotificationQueryOptions,
} from '@rallia/shared-types';

// Context types for optimistic updates
interface MutationContext {
  previousQueries: Array<{
    queryKey: readonly unknown[];
    data: InfiniteData<NotificationsPage> | undefined;
  }>;
  previousUnreadCount: number | undefined;
}

interface DeleteMutationContext extends MutationContext {
  wasUnread: boolean;
}

// Query keys for cache management
export const notificationKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
  list: (userId: string, options?: NotificationQueryOptions) =>
    [...notificationKeys.lists(), userId, options] as const,
  unreadCount: (userId: string) => [...notificationKeys.all, 'unreadCount', userId] as const,
  unreadCountForSport: (userId: string, sportName: string) =>
    [...notificationKeys.all, 'unreadCountForSport', userId, sportName] as const,
  unreadCountBySport: (userId: string, sportName: string) =>
    [...notificationKeys.all, 'unreadCountBySport', userId, sportName] as const,
};

interface UseNotificationsOptions extends Omit<NotificationQueryOptions, 'cursor'> {
  /** Enable/disable the query */
  enabled?: boolean;
}

/**
 * Hook for fetching paginated notifications with infinite scrolling
 */
export function useNotifications(
  userId: string | undefined,
  options: UseNotificationsOptions = {}
) {
  const { enabled = true, ...queryOptions } = options;

  return useInfiniteQuery<NotificationsPage, Error>({
    queryKey: notificationKeys.list(userId ?? '', queryOptions),
    queryFn: async ({ pageParam }) => {
      if (!userId) {
        return { notifications: [], nextCursor: null, hasMore: false };
      }
      return getNotifications(userId, {
        ...queryOptions,
        cursor: pageParam as string | undefined,
      });
    },
    getNextPageParam: lastPage => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: enabled && !!userId,
    staleTime: 1000 * 60, // 1 minute
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Hook for fetching unread notification count
 *
 * Note: Polling is disabled since we use Supabase Realtime via useNotificationRealtime
 * to get instant updates when notifications change.
 */
export function useUnreadNotificationCount(userId: string | undefined) {
  return useQuery<number, Error>({
    queryKey: notificationKeys.unreadCount(userId ?? ''),
    queryFn: async () => {
      if (!userId) return 0;
      return getUnreadCount(userId);
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5, // 5 minutes - realtime handles updates
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // No polling needed - useNotificationRealtime invalidates cache on changes
  });
}

/**
 * Hook for fetching unread notification count filtered to the selected sport.
 * Counts notifications for the given sport + system/social notifications (no sportName in payload).
 */
export function useUnreadCountForSport(userId: string | undefined, sportName: string | undefined) {
  return useQuery<number, Error>({
    queryKey: notificationKeys.unreadCountForSport(userId ?? '', sportName ?? ''),
    queryFn: async () => {
      if (!userId || !sportName) return 0;
      return getUnreadCountForSport(userId, sportName);
    },
    enabled: !!userId && !!sportName,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Helper: cancel, optimistically update, and invalidate ALL unread count queries
 * (unreadCount, unreadCountForSport, unreadCountBySport).
 */
function isUnreadCountQuery(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] === 'notifications' &&
    typeof queryKey[1] === 'string' &&
    (queryKey[1] === 'unreadCount' ||
      queryKey[1] === 'unreadCountForSport' ||
      queryKey[1] === 'unreadCountBySport')
  );
}

// Extended context for mark as read mutation
interface MarkAsReadMutationContext extends MutationContext {
  wasUnread: boolean;
}

/**
 * Hook for marking a single notification as read
 */
export function useMarkAsRead(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<Notification, Error, string, MarkAsReadMutationContext>({
    mutationFn: markAsRead,
    onMutate: async notificationId => {
      // Cancel any outgoing refetches for notifications and all unread counts
      await queryClient.cancelQueries({
        queryKey: notificationKeys.lists(),
      });
      await queryClient.cancelQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });

      // Get all notification list queries for this user and update them
      const queryCache = queryClient.getQueryCache();
      const queries = queryCache.findAll({
        queryKey: notificationKeys.lists(),
      });

      // Store previous data for all matching queries
      const previousQueries: Array<{
        queryKey: readonly unknown[];
        data: InfiniteData<NotificationsPage> | undefined;
      }> = [];

      // Check if the notification was actually unread before updating
      let wasUnread = false;
      queries.forEach(query => {
        const data = query.state.data as InfiniteData<NotificationsPage> | undefined;
        if (data) {
          data.pages.forEach(page => {
            const notification = page.notifications.find(n => n.id === notificationId);
            if (notification && !notification.read_at) {
              wasUnread = true;
            }
          });
        }
      });

      // Optimistically update all notification list queries
      queries.forEach(query => {
        const data = query.state.data as InfiniteData<NotificationsPage> | undefined;
        if (data) {
          previousQueries.push({ queryKey: query.queryKey, data });
          queryClient.setQueryData<InfiniteData<NotificationsPage>>(query.queryKey, {
            ...data,
            pages: data.pages.map(page => ({
              ...page,
              notifications: page.notifications.map(n =>
                n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n
              ),
            })),
          });
        }
      });

      // Optimistically decrement ALL cached unread count queries
      const previousUnreadCount = queryClient.getQueryData<number>(
        notificationKeys.unreadCount(userId ?? '')
      );
      if (wasUnread) {
        const countQueries = queryCache.findAll({
          predicate: query => isUnreadCountQuery(query.queryKey),
        });
        countQueries.forEach(query => {
          queryClient.setQueryData<number>(query.queryKey, old => Math.max(0, (old ?? 0) - 1));
        });
      }

      return { previousQueries, previousUnreadCount, wasUnread };
    },
    onError: (_err, _notificationId, context) => {
      // Rollback all queries on error — invalidation in onSettled will re-sync
      context?.previousQueries?.forEach(({ queryKey, data }) => {
        queryClient.setQueryData(queryKey, data);
      });
      // Invalidate all counts to re-sync from server
      queryClient.invalidateQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });
    },
    onSettled: () => {
      // Re-sync all unread counts with the server after mutation
      queryClient.invalidateQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });
    },
  });
}

/**
 * Hook for marking all notifications as read
 */
export function useMarkAllAsRead(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, void, MutationContext>({
    mutationFn: async () => {
      if (!userId) throw new Error('User ID is required');
      return markAllAsRead(userId);
    },
    onMutate: async () => {
      // Cancel any outgoing refetches for notifications and all unread counts
      await queryClient.cancelQueries({
        queryKey: notificationKeys.lists(),
      });
      await queryClient.cancelQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });

      // Get all notification list queries and update them
      const queryCache = queryClient.getQueryCache();
      const queries = queryCache.findAll({
        queryKey: notificationKeys.lists(),
      });

      // Store previous data for all matching queries
      const previousQueries: Array<{
        queryKey: readonly unknown[];
        data: InfiniteData<NotificationsPage> | undefined;
      }> = [];

      const now = new Date().toISOString();

      // Optimistically mark all as read in all queries
      queries.forEach(query => {
        const data = query.state.data as InfiniteData<NotificationsPage> | undefined;
        if (data) {
          previousQueries.push({ queryKey: query.queryKey, data });
          queryClient.setQueryData<InfiniteData<NotificationsPage>>(query.queryKey, {
            ...data,
            pages: data.pages.map(page => ({
              ...page,
              notifications: page.notifications.map(n => ({
                ...n,
                read_at: n.read_at ?? now,
              })),
            })),
          });
        }
      });

      // Optimistically set ALL cached unread counts to 0
      const previousUnreadCount = queryClient.getQueryData<number>(
        notificationKeys.unreadCount(userId ?? '')
      );
      const countQueries = queryCache.findAll({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });
      countQueries.forEach(query => {
        queryClient.setQueryData<number>(query.queryKey, 0);
      });

      return { previousQueries, previousUnreadCount };
    },
    onError: (_err, _vars, context) => {
      // Rollback list queries on error
      context?.previousQueries?.forEach(({ queryKey, data }) => {
        queryClient.setQueryData(queryKey, data);
      });
      // Invalidate all counts to re-sync from server
      queryClient.invalidateQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });
    },
  });
}

/**
 * Hook for deleting a notification
 */
export function useDeleteNotification(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string, DeleteMutationContext>({
    mutationFn: deleteNotification,
    onMutate: async notificationId => {
      // Cancel any outgoing refetches for notifications and all unread counts
      await queryClient.cancelQueries({
        queryKey: notificationKeys.lists(),
      });
      await queryClient.cancelQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });

      // Get all notification list queries
      const queryCache = queryClient.getQueryCache();
      const queries = queryCache.findAll({
        queryKey: notificationKeys.lists(),
      });

      // Store previous data and check if notification was unread
      const previousQueries: Array<{
        queryKey: readonly unknown[];
        data: InfiniteData<NotificationsPage> | undefined;
      }> = [];
      let wasUnread = false;

      // Find if notification was unread in any query
      queries.forEach(query => {
        const data = query.state.data as InfiniteData<NotificationsPage> | undefined;
        if (data) {
          data.pages.forEach(page => {
            const notification = page.notifications.find(n => n.id === notificationId);
            if (notification && !notification.read_at) {
              wasUnread = true;
            }
          });
        }
      });

      // Optimistically remove the notification from all queries
      queries.forEach(query => {
        const data = query.state.data as InfiniteData<NotificationsPage> | undefined;
        if (data) {
          previousQueries.push({ queryKey: query.queryKey, data });
          queryClient.setQueryData<InfiniteData<NotificationsPage>>(query.queryKey, {
            ...data,
            pages: data.pages.map(page => ({
              ...page,
              notifications: page.notifications.filter(n => n.id !== notificationId),
            })),
          });
        }
      });

      // Optimistically decrement ALL cached unread count queries
      const previousUnreadCount = queryClient.getQueryData<number>(
        notificationKeys.unreadCount(userId ?? '')
      );
      if (wasUnread) {
        const countQueries = queryCache.findAll({
          predicate: query => isUnreadCountQuery(query.queryKey),
        });
        countQueries.forEach(query => {
          queryClient.setQueryData<number>(query.queryKey, old => Math.max(0, (old ?? 0) - 1));
        });
      }

      return { previousQueries, previousUnreadCount, wasUnread };
    },
    onError: (_err, _notificationId, context) => {
      // Rollback list queries on error
      context?.previousQueries?.forEach(({ queryKey, data }) => {
        queryClient.setQueryData(queryKey, data);
      });
      // Invalidate all counts to re-sync from server
      queryClient.invalidateQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        predicate: query => isUnreadCountQuery(query.queryKey),
      });
    },
  });
}

/**
 * Hook that returns unread notification counts for sports OTHER than the currently selected one.
 * Useful for showing badges on the sport selector indicating pending actions in other sports.
 */
export function useOtherSportsUnreadCount(
  userId: string | undefined,
  userSports: Array<{ name: string }>,
  selectedSportName: string | undefined
) {
  const otherSports = userSports.filter(s => s.name !== selectedSportName);

  const queries = useQueries({
    queries: otherSports.map(sport => ({
      queryKey: notificationKeys.unreadCountBySport(userId ?? '', sport.name),
      queryFn: () => {
        if (!userId) return 0;
        return getUnreadCountBySport(userId, sport.name);
      },
      enabled: !!userId && !!selectedSportName,
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    })),
  });

  const otherSportsUnreadCount: Record<string, number> = {};
  let totalOtherSportsUnread = 0;

  otherSports.forEach((sport, index) => {
    const count = queries[index]?.data ?? 0;
    otherSportsUnreadCount[sport.name] = count;
    totalOtherSportsUnread += count;
  });

  return { otherSportsUnreadCount, totalOtherSportsUnread };
}

/**
 * Combined hook that provides all notification functionality
 */
export function useNotificationsWithActions(
  userId: string | undefined,
  options: UseNotificationsOptions = {}
) {
  const notifications = useNotifications(userId, options);
  const unreadCount = useUnreadNotificationCount(userId);
  const markAsReadMutation = useMarkAsRead(userId);
  const markAllAsReadMutation = useMarkAllAsRead(userId);
  const deleteMutation = useDeleteNotification(userId);

  // Flatten pages into a single array of notifications
  const allNotifications = notifications.data?.pages.flatMap(page => page.notifications) ?? [];

  return {
    // Query states
    notifications: allNotifications,
    isLoading: notifications.isLoading,
    isFetching: notifications.isFetching,
    isFetchingNextPage: notifications.isFetchingNextPage,
    hasNextPage: notifications.hasNextPage,
    error: notifications.error,

    // Pagination
    fetchNextPage: notifications.fetchNextPage,
    refetch: notifications.refetch,

    // Unread count
    unreadCount: unreadCount.data ?? 0,
    isLoadingUnreadCount: unreadCount.isLoading,

    // Mutations
    markAsRead: markAsReadMutation.mutate,
    isMarkingAsRead: markAsReadMutation.isPending,

    markAllAsRead: markAllAsReadMutation.mutate,
    isMarkingAllAsRead: markAllAsReadMutation.isPending,

    deleteNotification: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
}
