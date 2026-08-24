/**
 * isMilestoneActive — true while the milestone takeover is the focused route.
 * Mirrors isSerie2AnnouncementActive: the takeover is a navigator modal, not a
 * sheet, so getSheetStack() cannot see it and launch-time auto-openers that
 * could stack on top of it consult this instead.
 */
// Direct import to avoid the navigation→AppNavigator→screens cycle.
import { navigationRef } from '#/navigation/navigationRef';

const ROUTE_NAME = 'Milestone1000';

export function isMilestoneActive(): boolean {
  if (!navigationRef.isReady()) return false;
  return navigationRef.getCurrentRoute()?.name === ROUTE_NAME;
}
