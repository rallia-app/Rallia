/**
 * Gesture dispatch crash guard (REACT-NATIVE-EV).
 *
 * A fatal "undefined is not a function" fires inside react-native-actions-sheet's
 * pan `onEnd`, dispatched on the JS thread by gesture-handler's DeviceEventEmitter
 * listener. Sentry's frames inside the sheet library come back name-shuffled by
 * the source map (they arrive in an impossible caller order), so the trace never
 * names the callee, and the library is already on its newest release.
 *
 * This guards the two gesture dispatches and records what the stack could not:
 * which sheets were open, which gesture phase it was, and the raw unsymbolicated
 * stack. Production swallows the throw, because a failed sheet gesture is not
 * worth killing the app over; __DEV__ re-throws so the red box still fires for
 * whoever is holding the keyboard.
 */
import { DeviceEventEmitter } from 'react-native';
import { getSheetStack } from 'react-native-actions-sheet';
import { Logger } from '@rallia/shared-services';
import { createGuardedEmit } from '@rallia/shared-utils';

const GUARDED_EVENTS = new Set(['onGestureHandlerEvent', 'onGestureHandlerStateChange']);

// Enough of the stack to identify the frames, short enough to stay in the tag.
const MAX_STACK_CHARS = 2000;

interface GestureEventShape {
  state?: unknown;
  oldState?: unknown;
  handlerTag?: unknown;
  numberOfPointers?: unknown;
}

function describeGesture(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const event = payload as GestureEventShape;
  return {
    gestureState: event.state,
    gestureOldState: event.oldState,
    handlerTag: event.handlerTag,
    numberOfPointers: event.numberOfPointers,
  };
}

function openSheetIds(): string[] {
  try {
    return getSheetStack().map(sheet => sheet.id);
  } catch {
    return [];
  }
}

let installed = false;

export function installGestureCrashGuard(): void {
  if (installed) return;
  installed = true;

  // RN types emit() against its own event map; the guard is deliberately generic.
  const emitter = DeviceEventEmitter as unknown as {
    emit: (eventType: string, ...args: unknown[]) => void;
  };
  const originalEmit = emitter.emit.bind(emitter);

  emitter.emit = createGuardedEmit<string>(originalEmit, {
    shouldGuard: eventType => GUARDED_EVENTS.has(eventType),
    rethrow: () => __DEV__,
    onError: (error, eventType, args) => {
      const stack = error instanceof Error ? error.stack : undefined;
      Logger.error('Gesture dispatch threw', error as Error, {
        eventType,
        openSheets: openSheetIds(),
        ...describeGesture(args[0]),
        rawStack: stack?.slice(0, MAX_STACK_CHARS),
      });
    },
  });
}
