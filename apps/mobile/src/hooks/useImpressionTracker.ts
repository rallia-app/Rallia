import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';

type Fire = () => void;

/**
 * Fires each impression key at most once per focus session (the seen-set
 * clears on screen blur, so returning to the screen counts again). With
 * `gatedByDefault`, fires buffer until `setGate(true)` — for surfaces that
 * can be mounted but scrolled out of the viewport (the JFY carousel).
 *
 * All returned callbacks are referentially stable: safe to capture in
 * FlatList viewability handlers, which must never change identity.
 */
export function useImpressionTracker(options?: { gatedByDefault?: boolean }) {
  const seen = useRef<Set<string>>(new Set());
  const pending = useRef<Map<string, Fire>>(new Map());
  const gateOpen = useRef(!options?.gatedByDefault);

  useFocusEffect(
    useCallback(
      () => () => {
        seen.current.clear();
        pending.current.clear();
      },
      []
    )
  );

  const track = useCallback((key: string, fire: Fire) => {
    if (seen.current.has(key)) return;
    if (!gateOpen.current) {
      pending.current.set(key, fire);
      return;
    }
    seen.current.add(key);
    fire();
  }, []);

  /** Drop a buffered fire for an item that left the viewport before the gate opened. */
  const untrack = useCallback((key: string) => {
    pending.current.delete(key);
  }, []);

  const setGate = useCallback((open: boolean) => {
    gateOpen.current = open;
    if (!open) return;
    pending.current.forEach((fire, key) => {
      if (!seen.current.has(key)) {
        seen.current.add(key);
        fire();
      }
    });
    pending.current.clear();
  }, []);

  return { track, untrack, setGate };
}

export default useImpressionTracker;
