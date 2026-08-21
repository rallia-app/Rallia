/**
 * Tests for useMarkMessagesAsRead
 *
 * Focus: the optimistic unread reset must reach every conversation-list cache
 * (flat list, sport-scoped flat list, and the paginated inbox query) and the
 * two badge counts, roll back on error, and only the last of overlapping
 * calls may refetch.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { chatKeys, useMarkMessagesAsRead } from './useChat';

jest.mock('@rallia/shared-services', () => ({
  markMessagesAsRead: jest.fn(),
  Logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { markMessagesAsRead } from '@rallia/shared-services';

const PLAYER = '11111111-1111-4111-8111-111111111111';
const SPORT = '22222222-2222-4222-8222-222222222222';
const CONV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Row = { id: string; unread_count: number; is_archived?: boolean; title: string };
type Page = { conversations: Row[]; nextOffset: number | null; hasMore: boolean };

const rows = (overrides: Partial<Row> = {}): Row[] => [
  { id: CONV_A, unread_count: 3, title: 'A', ...overrides },
  { id: CONV_B, unread_count: 1, title: 'B' },
];

const FILTER_PARAMS = { filter: 'all', search: '', limit: 50, sportId: SPORT };
const TOTAL_UNREAD = 10;
const UNREAD_CONVS = 2;

function seed(queryClient: QueryClient, overridesA: Partial<Row> = {}) {
  queryClient.setQueryData(chatKeys.playerConversations(PLAYER), rows(overridesA));
  queryClient.setQueryData(chatKeys.playerConversations(PLAYER, SPORT), rows(overridesA));
  queryClient.setQueryData<InfiniteData<Page>>(
    chatKeys.filteredConversations(PLAYER, FILTER_PARAMS),
    {
      pages: [
        { conversations: [rows(overridesA)[0]], nextOffset: 1, hasMore: true },
        { conversations: [rows(overridesA)[1]], nextOffset: null, hasMore: false },
      ],
      pageParams: [0, 1],
    }
  );
  queryClient.setQueryData(chatKeys.unreadCount(PLAYER), TOTAL_UNREAD);
  queryClient.setQueryData(chatKeys.unreadConversationsCount(PLAYER), UNREAD_CONVS);
}

function readAll(queryClient: QueryClient) {
  const flat = queryClient.getQueryData<Row[]>(chatKeys.playerConversations(PLAYER))!;
  const sport = queryClient.getQueryData<Row[]>(chatKeys.playerConversations(PLAYER, SPORT))!;
  const paged = queryClient.getQueryData<InfiniteData<Page>>(
    chatKeys.filteredConversations(PLAYER, FILTER_PARAMS)
  )!;
  return {
    flat: Object.fromEntries(flat.map(r => [r.id, r.unread_count])),
    sport: Object.fromEntries(sport.map(r => [r.id, r.unread_count])),
    paged: Object.fromEntries(
      paged.pages.flatMap(p => p.conversations).map(r => [r.id, r.unread_count])
    ),
    total: queryClient.getQueryData<number>(chatKeys.unreadCount(PLAYER)),
    convs: queryClient.getQueryData<number>(chatKeys.unreadConversationsCount(PLAYER)),
  };
}

const SEEDED = {
  flat: { [CONV_A]: 3, [CONV_B]: 1 },
  sport: { [CONV_A]: 3, [CONV_B]: 1 },
  paged: { [CONV_A]: 3, [CONV_B]: 1 },
  total: TOTAL_UNREAD,
  convs: UNREAD_CONVS,
};

const READ_A = {
  flat: { [CONV_A]: 0, [CONV_B]: 1 },
  sport: { [CONV_A]: 0, [CONV_B]: 1 },
  paged: { [CONV_A]: 0, [CONV_B]: 1 },
  total: TOTAL_UNREAD - 3,
  convs: UNREAD_CONVS - 1,
};

function setup(overridesA: Partial<Row> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  seed(queryClient, overridesA);
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'QueryClientTestWrapper';
  const { result } = renderHook(() => useMarkMessagesAsRead(), { wrapper: Wrapper });
  return { queryClient, result };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useMarkMessagesAsRead', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('optimistically zeroes the conversation in every list cache and decrements both badge counts', async () => {
    const pending = deferred();
    (markMessagesAsRead as jest.Mock).mockReturnValue(pending.promise);
    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ conversationId: CONV_A, playerId: PLAYER });
    });

    await waitFor(() => {
      expect(readAll(queryClient).paged[CONV_A]).toBe(0);
    });
    expect(readAll(queryClient)).toEqual(READ_A);

    // Page metadata survives the patch
    const paged = queryClient.getQueryData<InfiniteData<Page>>(
      chatKeys.filteredConversations(PLAYER, FILTER_PARAMS)
    )!;
    expect(paged.pages.map(p => [p.nextOffset, p.hasMore])).toEqual([
      [1, true],
      [null, false],
    ]);
    expect(paged.pageParams).toEqual([0, 1]);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('leaves the badge counts alone for an archived conversation (they exclude archived)', async () => {
    const pending = deferred();
    (markMessagesAsRead as jest.Mock).mockReturnValue(pending.promise);
    const { queryClient, result } = setup({ is_archived: true });

    act(() => {
      result.current.mutate({ conversationId: CONV_A, playerId: PLAYER });
    });

    await waitFor(() => {
      expect(readAll(queryClient).paged[CONV_A]).toBe(0);
    });
    expect(readAll(queryClient)).toEqual({
      ...READ_A,
      total: TOTAL_UNREAD,
      convs: UNREAD_CONVS,
    });

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls every cache back when the server rejects', async () => {
    (markMessagesAsRead as jest.Mock).mockRejectedValue(new Error('boom'));
    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ conversationId: CONV_A, playerId: PLAYER });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(readAll(queryClient)).toEqual(SEEDED);
  });

  it('lets only the last of overlapping calls invalidate, and never double-decrements', async () => {
    const first = deferred();
    const second = deferred();
    (markMessagesAsRead as jest.Mock)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { queryClient, result } = setup();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      result.current.mutate({ conversationId: CONV_A, playerId: PLAYER });
      result.current.mutate({ conversationId: CONV_A, playerId: PLAYER });
    });

    await waitFor(() => expect(readAll(queryClient).paged[CONV_A]).toBe(0));
    expect(readAll(queryClient)).toEqual(READ_A);

    await act(async () => {
      first.resolve();
      await first.promise;
    });
    // First call fully settled (onSettled ran) while the second is still pending: no refetch yet
    await waitFor(() =>
      expect(queryClient.getMutationCache().findAll({ status: 'success' })).toHaveLength(1)
    );
    expect(queryClient.isMutating()).toBe(1);
    const listInvalidations = () =>
      invalidate.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) === JSON.stringify(chatKeys.conversations())
      ).length;
    expect(listInvalidations()).toBe(0);

    await act(async () => {
      second.resolve();
      await second.promise;
    });
    await waitFor(() => expect(listInvalidations()).toBe(1));
    expect(readAll(queryClient)).toEqual(READ_A);
  });
});
