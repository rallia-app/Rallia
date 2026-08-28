import { createGuardedEmit } from './createGuardedEmit';

const GUARDED = 'onGestureHandlerEvent';
const UNGUARDED = 'someOtherNativeEvent';

function setup(overrides: { rethrow?: boolean; onError?: jest.Mock } = {}) {
  const emit = jest.fn();
  const onError = overrides.onError ?? jest.fn();
  const guarded = createGuardedEmit<string>(emit, {
    shouldGuard: type => type === GUARDED,
    onError,
    rethrow: () => overrides.rethrow ?? false,
  });
  return { emit, onError, guarded };
}

describe('createGuardedEmit', () => {
  it('forwards the event type and every argument untouched', () => {
    const { emit, guarded } = setup();
    guarded(UNGUARDED, { a: 1 }, 'two', 3);
    expect(emit).toHaveBeenCalledWith(UNGUARDED, { a: 1 }, 'two', 3);
  });

  // The guard must not become a global catch-all: anything it was not scoped
  // to still crashes the way it did before.
  it('lets an unguarded dispatch throw through', () => {
    const { emit, onError, guarded } = setup();
    emit.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => guarded(UNGUARDED)).toThrow('boom');
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports and swallows a throw from a guarded dispatch', () => {
    const { emit, onError, guarded } = setup();
    const err = new Error('undefined is not a function');
    emit.mockImplementation(() => {
      throw err;
    });

    expect(() => guarded(GUARDED, { state: 5 })).not.toThrow();
    expect(onError).toHaveBeenCalledWith(err, GUARDED, [{ state: 5 }]);
  });

  it('reports and re-throws when rethrow() is true', () => {
    const { emit, onError, guarded } = setup({ rethrow: true });
    const err = new Error('undefined is not a function');
    emit.mockImplementation(() => {
      throw err;
    });

    expect(() => guarded(GUARDED)).toThrow(err);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps the original error when the reporter itself throws', () => {
    const onError = jest.fn(() => {
      throw new Error('reporter exploded');
    });
    const { emit, guarded } = setup({ rethrow: true, onError });
    const err = new Error('original');
    emit.mockImplementation(() => {
      throw err;
    });

    expect(() => guarded(GUARDED)).toThrow(err);
  });

  it('does not swallow anything while the dispatch succeeds', () => {
    const { emit, onError, guarded } = setup();
    guarded(GUARDED, { state: 4 });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
