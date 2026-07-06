/**
 * Shared module + status maps for the feedback browse/compose UIs.
 */

import { Ionicons } from '@expo/vector-icons';
import type { UserFeedbackModule, UserFeedbackStatus } from '@rallia/shared-services';
import { status } from '@rallia/design-system';

export interface FeedbackModuleOption {
  value: UserFeedbackModule;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}

export const FEEDBACK_MODULE_OPTIONS: FeedbackModuleOption[] = [
  { value: 'profile_settings', icon: 'person-outline', labelKey: 'bugReport.modules.profile' },
  { value: 'match_features', icon: 'people-outline', labelKey: 'bugReport.modules.matches' },
  { value: 'facilities', icon: 'location-outline', labelKey: 'bugReport.modules.facilities' },
  {
    value: 'player_directory',
    icon: 'search-outline',
    labelKey: 'bugReport.modules.playerDirectory',
  },
  {
    value: 'groups_communities',
    icon: 'globe-outline',
    labelKey: 'bugReport.modules.groupsCommunities',
  },
  {
    value: 'notifications',
    icon: 'notifications-outline',
    labelKey: 'bugReport.modules.notifications',
  },
  { value: 'performance', icon: 'speedometer-outline', labelKey: 'bugReport.modules.performance' },
  { value: 'other', icon: 'apps-outline', labelKey: 'bugReport.modules.other' },
];

export function getModuleIcon(module: UserFeedbackModule): keyof typeof Ionicons.glyphMap {
  return FEEDBACK_MODULE_OPTIONS.find(m => m.value === module)?.icon ?? 'apps-outline';
}

export function getModuleLabelKey(module: UserFeedbackModule): string {
  return (
    FEEDBACK_MODULE_OPTIONS.find(m => m.value === module)?.labelKey ?? 'bugReport.modules.other'
  );
}

/** Status pill color tokens — references status palette from design-system. */
export const STATUS_COLORS: Record<UserFeedbackStatus, { bg: string; fg: string }> = {
  new: { bg: '#3B82F61F', fg: '#3B82F6' },
  reviewed: { bg: '#8B5CF61F', fg: '#8B5CF6' },
  in_progress: { bg: '#F59E0B1F', fg: status.warning.DEFAULT },
  resolved: { bg: '#10B9811F', fg: status.success.light },
  closed: { bg: '#6B72801F', fg: '#6B7280' },
};
