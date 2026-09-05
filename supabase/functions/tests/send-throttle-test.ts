import { assertEquals } from 'jsr:@std/assert';

import {
  createSendThrottle,
  isRateLimitError,
  sendWithRateLimitRetry,
} from '../_shared/send-throttle.ts';

function fakeClock() {
  let t = 0;
  const timers: { at: number; resolve: () => void }[] = [];
  const requested: number[] = [];
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    now: () => t,
    requested,
    sleep: (ms: number) =>
      new Promise<void>(resolve => {
        requested.push(ms);
        timers.push({ at: t + ms, resolve });
      }),
    // Advances the clock, firing due timers in order and letting their continuations run.
    async advance(ms: number) {
      const target = t + ms;
      while (timers.some(x => x.at <= target)) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        if (!next) break;
        t = Math.max(t, next.at);
        next.resolve();
        await settle();
      }
      t = target;
      await settle();
    },
    async flush() {
      // Settle first so continuations that are about to sleep register their timers.
      await settle();
      while (timers.length) {
        const latest = Math.max(...timers.map(x => x.at));
        await this.advance(latest - t);
        await settle();
      }
    },
  };
}

Deno.test('throttle spaces calls to the configured rate', async () => {
  const clock = fakeClock();
  const throttle = createSendThrottle(8, clock.now, clock.sleep);
  const starts: number[] = [];

  const all = Promise.all(
    Array.from({ length: 4 }, () =>
      throttle.run(() => {
        starts.push(clock.now());
        return Promise.resolve();
      })
    )
  );
  await clock.flush();
  await all;

  assertEquals(starts, [0, 125, 250, 375]);
});

Deno.test('throttle does not delay a call that arrives after the window has passed', async () => {
  const clock = fakeClock();
  const throttle = createSendThrottle(8, clock.now, clock.sleep);

  await throttle.run(() => Promise.resolve());
  await clock.advance(1000);
  await throttle.run(() => Promise.resolve());

  assertEquals(clock.requested, []);
});

Deno.test('a 429 is retried after the rate window and the retry result is returned', async () => {
  const clock = fakeClock();
  const throttle = createSendThrottle(8, clock.now, clock.sleep);
  const answers = [
    { data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } },
    { data: { id: 'email_1' }, error: null },
  ];
  let calls = 0;
  const send = () => Promise.resolve(answers[calls++]);

  const pending = sendWithRateLimitRetry(throttle, send, clock.sleep);
  await clock.flush();
  const result = await pending;

  assertEquals(calls, 2);
  assertEquals(result.data, { id: 'email_1' });
  assertEquals(clock.requested, [1100]);
});

Deno.test('a non-rate-limit error is returned without a retry', async () => {
  const clock = fakeClock();
  const throttle = createSendThrottle(8, clock.now, clock.sleep);
  let calls = 0;
  const send = () => {
    calls++;
    return Promise.resolve({ data: null, error: { name: 'validation_error', message: 'bad' } });
  };

  const result = await sendWithRateLimitRetry(throttle, send, clock.sleep);

  assertEquals(calls, 1);
  assertEquals(isRateLimitError(result.error), false);
});

Deno.test('retries stop after the budget and the last 429 is returned', async () => {
  const clock = fakeClock();
  const throttle = createSendThrottle(8, clock.now, clock.sleep);
  let calls = 0;
  const send = () => {
    calls++;
    return Promise.resolve({
      data: null,
      error: { statusCode: 429, message: 'Too many requests' },
    });
  };

  const pending = sendWithRateLimitRetry(throttle, send, clock.sleep);
  await clock.flush();
  const result = await pending;

  assertEquals(calls, 3);
  assertEquals(isRateLimitError(result.error), true);
});
