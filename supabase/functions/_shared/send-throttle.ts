// Resend allows 10 requests/second per account and answers 429 above that.
export interface SendThrottle {
  /** Runs `fn` no sooner than the pacing allows; call order is preserved. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createSendThrottle(
  perSecond: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): SendThrottle {
  const interval = 1000 / perSecond;
  let nextSlot = 0;
  return {
    async run(fn) {
      const slot = Math.max(nextSlot, now());
      nextSlot = slot + interval;
      const wait = slot - now();
      if (wait > 0) await sleep(wait);
      return fn();
    },
  };
}

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, statusCode, message } = error as {
    name?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  return (
    name === 'rate_limit_exceeded' ||
    statusCode === 429 ||
    (typeof message === 'string' && message.includes('Too many requests'))
  );
}

const RATE_LIMIT_RETRY_DELAYS_MS = [1100, 2200];

// `send` resolves to Resend's { data, error }; only a rate-limit error is retried.
export async function sendWithRateLimitRetry<T extends { error?: unknown }>(
  throttle: SendThrottle,
  send: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): Promise<T> {
  let result = await throttle.run(send);
  for (const delay of RATE_LIMIT_RETRY_DELAYS_MS) {
    if (!isRateLimitError(result.error)) return result;
    await sleep(delay);
    result = await throttle.run(send);
  }
  return result;
}
