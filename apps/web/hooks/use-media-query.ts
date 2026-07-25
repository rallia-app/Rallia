'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * SSR-safe media query hook.
 *
 * Uses useSyncExternalStore so the value is read during render rather than set in an
 * effect — an effect would render the wrong branch first and flash the mobile drawer
 * on desktop before correcting.
 *
 * The server snapshot is `false` (the mobile branch), which matches the mobile-first
 * CSS: hydration then upgrades to the desktop branch if the query matches.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === 'undefined') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Tailwind's `md` breakpoint — the dialog/drawer switch point for overlays. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
