import { awaitWebhookSettle } from './awaitWebhookSettle';

describe('awaitWebhookSettle', () => {
  it('returns immediately when the webhook already landed', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const settled = await awaitWebhookSettle({
      refresh,
      isSettled: () => true,
      intervalMs: 1,
    });
    expect(settled).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps polling past the old fixed 2.5s window', async () => {
    // The bug this replaces: the screen refreshed once, then once more at a
    // flat 2.5s, and gave up. A webhook landing on the 4th read has to be
    // caught, not missed.
    let reads = 0;
    const refresh = jest.fn().mockImplementation(() => {
      reads += 1;
      return Promise.resolve();
    });
    const settled = await awaitWebhookSettle({
      refresh,
      isSettled: () => reads >= 4,
      intervalMs: 1,
      timeoutMs: 1_000,
    });
    expect(settled).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('gives up at the timeout instead of polling forever', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const settled = await awaitWebhookSettle({
      refresh,
      isSettled: () => false,
      intervalMs: 5,
      timeoutMs: 40,
    });
    // False is not an error: the charge went through, the webhook is just slow.
    expect(settled).toBe(false);
    expect(refresh.mock.calls.length).toBeGreaterThan(1);
  });

  it('stops when aborted, so an unmounted screen leaves nothing running', async () => {
    const controller = new AbortController();
    const refresh = jest.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });
    const settled = await awaitWebhookSettle({
      refresh,
      isSettled: () => false,
      intervalMs: 5,
      timeoutMs: 500,
      signal: controller.signal,
    });
    expect(settled).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
