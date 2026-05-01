/**
 * Unit tests for the serial write-queue pattern used in outboxStore.
 *
 * The outboxStore itself lives in apps/mobile (needs AsyncStorage + Logger),
 * so we test the queue logic directly here to verify the race-condition fix
 * without requiring a React Native environment.
 */

// ---------------------------------------------------------------------------
// Inline implementation (mirrors outboxStore.ts enqueueWrite exactly)
// ---------------------------------------------------------------------------

function makeSerialQueue() {
  let writeQueue: Promise<void> = Promise.resolve();

  function enqueueWrite(fn: () => Promise<void>): Promise<void> {
    const next = writeQueue.then(fn);
    writeQueue = next.catch(() => {});
    return next;
  }

  return { enqueueWrite };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serial write queue (outboxStore pattern)', () => {
  it('serializes concurrent writes — second write sees first write result', async () => {
    const { enqueueWrite } = makeSerialQueue();
    const log: string[] = [];

    // Fire two writes simultaneously
    const p1 = enqueueWrite(async () => {
      log.push('w1-start');
      await Promise.resolve(); // yield to event loop
      log.push('w1-end');
    });

    const p2 = enqueueWrite(async () => {
      log.push('w2-start');
      await Promise.resolve();
      log.push('w2-end');
    });

    await Promise.all([p1, p2]);

    // Strict ordering: w1 must fully complete before w2 begins
    expect(log).toEqual(['w1-start', 'w1-end', 'w2-start', 'w2-end']);
  });

  it('keeps the queue alive after a failing write', async () => {
    const { enqueueWrite } = makeSerialQueue();
    const log: string[] = [];

    const failing = enqueueWrite(async () => {
      throw new Error('write failed');
    });

    // Swallow the error on the caller side — the queue should still work
    await failing.catch(() => {});

    const succeeding = enqueueWrite(async () => {
      log.push('success');
    });

    await succeeding;

    expect(log).toEqual(['success']);
  });

  it('surfaces errors to the caller of the failing write', async () => {
    const { enqueueWrite } = makeSerialQueue();

    const result = await enqueueWrite(async () => {
      throw new Error('boom');
    }).catch(err => err);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('boom');
  });

  it('third write still runs after second write fails', async () => {
    const { enqueueWrite } = makeSerialQueue();
    const log: string[] = [];

    const p1 = enqueueWrite(async () => {
      log.push('p1');
    });
    const p2 = enqueueWrite(async () => {
      throw new Error('p2 failed');
    });
    const p3 = enqueueWrite(async () => {
      log.push('p3');
    });

    await p1;
    await p2.catch(() => {});
    await p3;

    expect(log).toEqual(['p1', 'p3']);
  });

  it('serializes N concurrent writes in submission order', async () => {
    const { enqueueWrite } = makeSerialQueue();
    const results: number[] = [];
    const N = 20;

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        enqueueWrite(async () => {
          results.push(i);
        })
      )
    );

    expect(results).toEqual(Array.from({ length: N }, (_, i) => i));
  });
});
