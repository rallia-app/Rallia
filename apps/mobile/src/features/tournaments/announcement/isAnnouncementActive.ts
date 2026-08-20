/**
 * isSerie2AnnouncementActive — true while the Série 2 announcement screen is
 * the focused route. Mirrors isWeeklyCheckInActive: launch-time auto-openers
 * that could race the announcement (e.g. the referral invite prompt) consult
 * this and yield.
 */
// Direct import to avoid the navigation→AppNavigator→screens cycle.
import { navigationRef } from '#/navigation/navigationRef';

const ROUTE_NAME = 'Serie2Announcement';

export function isSerie2AnnouncementActive(): boolean {
  if (!navigationRef.isReady()) return false;
  return navigationRef.getCurrentRoute()?.name === ROUTE_NAME;
}
