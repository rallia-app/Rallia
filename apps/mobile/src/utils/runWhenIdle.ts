/**
 * Defers non-critical work until the JS thread is idle.
 *
 * Drop-in replacement for the deprecated
 * `InteractionManager.runAfterInteractions`: it returns a handle whose
 * `cancel()` aborts the pending callback, so existing
 * `const handle = ...; return () => handle.cancel();` cleanup patterns keep
 * working unchanged.
 *
 * The `timeout` cap guarantees the callback still fires on a thread that never
 * goes fully idle, preserving `runAfterInteractions`' "runs once things settle"
 * guarantee rather than `requestIdleCallback`'s "maybe never" default.
 *
 * `requestIdleCallback` / `cancelIdleCallback` are React Native globals (typed
 * via the DOM lib in tsconfig).
 */
export function runWhenIdle(
  callback: () => void,
  options?: { timeout?: number }
): { cancel: () => void } {
  const handle = requestIdleCallback(callback, { timeout: options?.timeout ?? 500 });
  return {
    cancel: () => cancelIdleCallback(handle),
  };
}
