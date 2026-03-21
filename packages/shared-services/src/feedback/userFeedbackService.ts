/**
 * User Feedback Service
 */
import { supabase } from '../supabase';

export type UserFeedbackCategory = 'bug' | 'feature' | 'improvement' | 'other';

export const USER_FEEDBACK_CATEGORY_LABELS: Record<UserFeedbackCategory, string> = {
  bug: 'Bug Report',
  feature: 'Feature Request',
  improvement: 'Improvement',
  other: 'Other',
};

/** App module/feature area for feedback categorization */
export type UserFeedbackModule =
  | 'profile_settings'
  | 'match_features'
  | 'facilities'
  | 'player_directory'
  | 'groups_communities'
  | 'notifications'
  | 'performance'
  | 'other';

export const USER_FEEDBACK_MODULE_LABELS: Record<UserFeedbackModule, string> = {
  profile_settings: 'Profile & Settings',
  match_features: 'Match Features',
  facilities: 'Facilities',
  player_directory: 'Player Directory',
  groups_communities: 'Groups & Communities',
  notifications: 'Notifications',
  performance: 'Performance',
  other: 'Other',
};

// Category-specific metadata types
export interface BugFeedbackMetadata {
  severity: 'minor' | 'major' | 'critical';
  steps_to_reproduce: string;
  expected_vs_actual: string;
}

export interface FeatureFeedbackMetadata {
  feature_title: string;
  description: string;
  use_case: string;
}

export interface ImprovementFeedbackMetadata {
  disappointment_score: 'very_disappointed' | 'somewhat_disappointed' | 'not_disappointed';
  main_benefit: string;
  ideal_user: string;
  how_to_improve: string;
}

export type UserFeedbackMetadata =
  | BugFeedbackMetadata
  | FeatureFeedbackMetadata
  | ImprovementFeedbackMetadata;

export type UserFeedbackStatus = 'new' | 'reviewed' | 'in_progress' | 'resolved' | 'closed';

export interface UserFeedbackSubmission {
  id: string;
  player_id: string | null;
  category: UserFeedbackCategory;
  module: UserFeedbackModule;
  subject: string;
  message: string;
  app_version: string | null;
  device_info: Record<string, unknown> | null;
  screenshot_urls: string[] | null;
  metadata: UserFeedbackMetadata | null;
  status: UserFeedbackStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserFeedbackParams {
  playerId?: string;
  category: UserFeedbackCategory;
  module?: UserFeedbackModule;
  subject?: string;
  message?: string;
  metadata?: UserFeedbackMetadata;
  screenshotUrls?: string[];
  /** Platform-specific device info (caller should provide) */
  deviceInfo?: Record<string, unknown>;
  /** App version string (caller should provide) */
  appVersion?: string;
}

export async function submitUserFeedback(
  params: CreateUserFeedbackParams
): Promise<UserFeedbackSubmission> {
  const {
    playerId,
    category,
    module,
    subject,
    message,
    metadata,
    screenshotUrls,
    deviceInfo,
    appVersion,
  } = params;
  const row = {
    player_id: playerId || null,
    category,
    module: module || 'other',
    subject: subject || '',
    message: message || '',
    metadata: metadata || null,
    app_version: appVersion || null,
    device_info: deviceInfo || null,
    screenshot_urls: screenshotUrls || [],
    status: 'new' as const,
  };

  const { data, error } = await supabase.from('feedback').insert(row).select().single();
  if (error) {
    console.error('Error submitting feedback:', error);
    throw new Error('Failed to submit feedback.');
  }
  return data;
}

export async function getUserFeedbackHistory(playerId: string): Promise<UserFeedbackSubmission[]> {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching user feedback:', error);
    throw new Error('Failed to fetch feedback history.');
  }
  return data || [];
}

export async function getUserFeedbackById(
  feedbackId: string,
  playerId: string
): Promise<UserFeedbackSubmission | null> {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('id', feedbackId)
    .eq('player_id', playerId)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error:', error);
    throw new Error('Failed to fetch feedback.');
  }
  return data;
}
