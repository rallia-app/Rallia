/**
 * Guard a synchronous event dispatch.
 *
 * React Native delivers native events by calling `emit()` on a shared emitter,
 * so a listener that throws propagates back out through the emitter and reaches
 * the global handler as a fatal error, taking the app down with it. When that
 * listener lives in a library we cannot edit, wrapping `emit` is the only seam
 * available: it catches the throw at the dispatch itself, with the event
 * payload still in hand, and decides whether the app should die for it.
 *
 * Scope every guard to the event types you actually mean to protect. A blanket
 * guard hides real bugs instead of surfacing them.
 */

export interface GuardedEmitOptions<TEvent extends string> {
  /** Only these dispatches are wrapped; every other one passes straight through. */
  shouldGuard: (eventType: TEvent) => boolean;
  /** Receives whatever the listener threw. Its own failures are ignored. */
  onError: (error: unknown, eventType: TEvent, args: unknown[]) => void;
  /** Re-throw after reporting, for builds that should show the crash. */
  rethrow: () => boolean;
}

export function createGuardedEmit<TEvent extends string>(
  emit: (eventType: TEvent, ...args: unknown[]) => void,
  options: GuardedEmitOptions<TEvent>
): (eventType: TEvent, ...args: unknown[]) => void {
  return function guardedEmit(eventType: TEvent, ...args: unknown[]): void {
    if (!options.shouldGuard(eventType)) {
      emit(eventType, ...args);
      return;
    }

    try {
      emit(eventType, ...args);
    } catch (error) {
      try {
        options.onError(error, eventType, args);
      } catch {
        // A reporter that fails must not replace the error it was reporting.
      }
      if (options.rethrow()) throw error;
    }
  };
}
