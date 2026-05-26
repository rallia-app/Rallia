/**
 * Helpers to keep other auto-opening modals/sheets out of the wizard's way.
 *
 *   isWeeklyCheckInActive()
 *     Returns true if the WeeklyCheckIn route is the currently-focused
 *     screen. Use this from any handler in AppContent (DeepLinkHandler,
 *     PendingFeedbackHandler, etc.) that might race the wizard at app
 *     launch — bail out of the auto-open if the wizard is up.
 *
 *   useIsWeeklyCheckInActive()
 *     React hook variant — re-renders the caller when the route changes
 *     so guards can be reactive (e.g., a modal becomes safe to open after
 *     the wizard is dismissed).
 */
import { useEffect, useState } from 'react';

import { navigationRef } from '#/navigation';

const ROUTE_NAME = 'WeeklyCheckIn';

export function isWeeklyCheckInActive(): boolean {
  if (!navigationRef.isReady()) return false;
  return navigationRef.getCurrentRoute()?.name === ROUTE_NAME;
}

export function useIsWeeklyCheckInActive(): boolean {
  const [active, setActive] = useState(isWeeklyCheckInActive);

  useEffect(() => {
    const update = () => setActive(isWeeklyCheckInActive());
    // Subscribe to navigation state changes; navigationRef exposes this
    // even when the listener is registered outside of NavigationContainer.
    const unsub = navigationRef.addListener?.('state', update);
    // Also poll once after mount in case the route was already focused.
    update();
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  return active;
}
