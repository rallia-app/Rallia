/**
 * Unit tests for the withRetry helper used in chatAttachmentUpload.
 *
 * chatAttachmentUpload lives in apps/mobile (needs Expo/RN), so we test the
 * retry logic directly here by inlining the same implementation.
 */

// ---------------------------------------------------------------------------
// Inline implementation (mirrors chatAttachmentUpload.ts withRetry exactly)
// ---------------------------------------------------------------------------

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 1000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== undefined && status >= 400 && status < 500) throw err;
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Mock setTimeout so retries don't actually wait
jest.useFakeTimers();

describe('withRetry (chatAttachmentUpload pattern)', () => {
  afterEach(() => jest.clearAllTimers());

  it('returns result immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxAttempts on network errors', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue('success on third');

    const promise = withRetry(fn, 3, 0);
    // Flush all timers for the retry delays
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success on third');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx errors', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRetry(fn, 3, 0)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 400 Bad Request', async () => {
    const err = Object.assign(new Error('Bad Request'), { status: 400 });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRetry(fn, 3, 0)).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('DOES retry on 500 server errors', async () => {
    const serverErr = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const fn = jest.fn().mockRejectedValueOnce(serverErr).mockResolvedValue('recovered');

    const promise = withRetry(fn, 3, 0);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all attempts', async () => {
    // Use baseDelayMs = 0 so setTimeout fires immediately without fake-timer advancement
    const fn = jest.fn().mockImplementation(() => Promise.reject(new Error('always fails')));

    let caught: Error | null = null;
    try {
      jest.useRealTimers();
      await withRetry(fn, 3, 0);
    } catch (err) {
      caught = err as Error;
    } finally {
      jest.useFakeTimers();
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff between retries', async () => {
    const delays: number[] = [];
    const originalSetTimeout = global.setTimeout;

    jest.useRealTimers();
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((cb: TimerHandler, delay?: number) => {
        if (typeof delay === 'number') delays.push(delay);
        (cb as () => void)();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    await withRetry(fn, 3, 100);

    // attempt 0→1: 100 * 2^0 = 100ms; attempt 1→2: 100 * 2^1 = 200ms
    expect(delays).toEqual([100, 200]);

    setTimeoutSpy.mockRestore();
    jest.useFakeTimers();
  });

  it('retries errors with no status property', async () => {
    const noStatusErr = new Error('connection reset');
    const fn = jest.fn().mockRejectedValueOnce(noStatusErr).mockResolvedValue('ok');

    const promise = withRetry(fn, 3, 0);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
